# Forward-to-Nudged: WhatsApp, texts and everything else

Written 2026-10-21. Spec for taking messages Nudged cannot read on its own. Part of Pro (see `product-model.md` §2). Three ingestion routes feed one pipeline and one `notes` table:

1. **WhatsApp number** — the user forwards a message to Nudged's WhatsApp Business number.
2. **Share-sheet** — the user shares a message from any app into the Nudged app.
3. **Mac Messages** — the plugin reads the Messages database on the user's Mac (automatic; plugin only; separate section at the end).

Android's notification listener is noted at the end and not built now.

## 1. Why hand-off, not reading

- WhatsApp: no API for personal chats. The Business Platform (Cloud API) only receives messages people send *to* a business number. Unofficial WhatsApp Web automation violates Meta's terms and gets numbers banned.
- iOS: no API for SMS or iMessage. Share-sheet is the only door.
- Android: `READ_SMS` is restricted to default SMS apps. The notification listener sees incoming notifications only.

So the honest product statement is: *Nudged watches your email on its own. For anything else, flick it a message.* A forwarded message arrives without its thread, so Nudged can hold the promise and nudge the user, but cannot tell whether the other side replied. Say this in the product, once, plainly.

## 2. User experience

### Linking WhatsApp (once)

1. App → Settings → "Connect WhatsApp". The app shows a button that opens `https://wa.me/<NUDGED_NUMBER>?text=NUDGED-K7Q2` (a one-time link code, 6 characters, valid 15 minutes).
2. The user taps Send in WhatsApp.
3. The webhook sees the code, binds the sender's `wa_id` to the user, and replies: *"Linked. Forward me any message with a promise or a date and I'll put it on your board."*
4. Settings shows "WhatsApp: linked as +1 416 ••• 1234" with a Disconnect button.

### Forwarding (every time)

1. In any WhatsApp chat, long-press → Forward → Nudged.
2. Within a few seconds Nudged replies in the same chat with one of:
   - *"Got it: 'Dock inspection Tue 2pm, Mike' is on your board and your calendar."*
   - *"Got it: 'Deliver the chairs Friday' — who is that from?"* (when the forwarded text names no one; the user's next message answers it)
   - *"I couldn't find a promise or a date in that. Nothing added."*
   - *"Forwarding is part of Nudged Pro. Start your 14-day trial at nudged.pro/upgrade."* (free plan; the message is discarded)
3. The note on the board carries a WhatsApp badge and the paraphrased clip. No "Open email" button; a "Reply in WhatsApp" link (`https://wa.me/<other party>` only when the user told us the number; otherwise absent).

### Sharing from the app's share-sheet

Any app → Share → Nudged. The Nudged app opens on a small sheet: the shared text, a "Who is this from?" field (prefilled when the share includes a contact name), and Add. Submits to the same pipeline. Works for SMS, iMessage, Signal, Telegram, Slack, screenshots (image → Claude vision; phase 2).

## 3. Data model (Supabase, `backend/supabase/migrations/0004_channels.sql`)

```sql
create table public.channel_links (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  channel      text not null check (channel in ('whatsapp')),   -- 'sms' etc. later
  external_id  text not null,            -- WhatsApp wa_id (E.164 digits)
  display      text,                     -- masked number for Settings
  linked_at    timestamptz not null default now(),
  primary key (channel, external_id),
  unique (user_id, channel)
);

create table public.link_codes (
  code        text primary key,          -- NUDGED-XXXX
  user_id     uuid not null references public.profiles(id) on delete cascade,
  channel     text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table public.inbound_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade,
  channel       text not null,           -- whatsapp | share
  external_id   text,                    -- WhatsApp message id; null for share
  body          text,                    -- raw text, deleted after processing (see §6)
  from_hint     text,                    -- "Mike the plumber", if the user told us
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  note_id       uuid references public.notes(id),
  outcome       text,                    -- added | updated | nothing_found | plan_blocked | error
  unique (channel, external_id)
);

alter table public.notes add column if not exists source text not null default 'email';   -- email | whatsapp | share | imessage
alter table public.notes add column if not exists source_ref text;                          -- inbound_messages.id or Gmail thread id
```

RLS as in `0002_app_core.sql`: users select their own rows; only the service role writes.

## 4. Edge functions

### `whatsapp-webhook` (`verify_jwt=false`)

- `GET` with `hub.mode=subscribe`: compare `hub.verify_token` to `WHATSAPP_VERIFY_TOKEN`, return `hub.challenge`.
- `POST`: verify `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with `WHATSAPP_APP_SECRET`). Reject on mismatch.
- For each `entry[].changes[].value.messages[]`:
  1. Insert into `inbound_messages` with `(channel='whatsapp', external_id=message.id)`; on unique violation, stop (Meta retries).
  2. If `text.body` matches `^NUDGED-[A-Z2-9]{4}$`: look up `link_codes`, bind `channel_links`, mark the code used, reply "Linked". Done.
  3. Find the user by `channel_links (whatsapp, from)`. None → reply once with the link instructions and stop.
  4. Licence: `licenses` row for the user's email. Plan `free` → `outcome='plan_blocked'`, reply with the upgrade line, delete the body, stop.
  5. If the message is a reply to Nudged's "who is that from?" (the previous `inbound_messages` row for this user has `outcome='needs_from'` within 24 h): set its `from_hint`, re-run extraction on it, stop.
  6. Extraction: same two-step as `nudged-sync` (`_shared/notes.ts`): Haiku triage "is there a promise or dated plan here?", Sonnet extraction on a hit. Input: the body, the `from_hint`, the user's timezone, today's date. Output: the note shape, or nothing.
  7. Match to an existing open note by other party + date, else insert with `source='whatsapp'`, `source_ref=inbound.id`. Calendar write as in sync (Pro only, always true here).
  8. Reply via `POST https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages` with the outcome line. Replies inside the 24-hour service window are free under Meta's current pricing (verify before launch; it has changed twice).
  9. Set `processed_at`, `outcome`, null the `body`.
- Always return 200 to Meta within 20 s; do the work after insert, before reply. If extraction fails, leave `body` for one retry by a scheduled sweep, then give up and null it. The sweep is `select public.inbound_scrub_stale();` from pg_cron hourly; a retry pass (re-run `processInbound` on rows with `outcome='error'`, `attempts=1`, body present) can be added to `nudged-sync`'s cron call when there is volume.

### `ingest` (`verify_jwt=true`)

`POST { text, from_hint?, image_base64? }` from the app's share-sheet. Inserts `inbound_messages (channel='share')`, runs steps 4, 6, 7 above, returns the note or `nothing_found`. Images: phase 2, Claude vision on the screenshot.

### `channel-link` (`verify_jwt=true`)

`POST { channel: 'whatsapp' }` → creates a `link_codes` row, returns `{ code, wa_url }`. `DELETE` → removes the user's `channel_links` row.

## 5. Meta setup (one-time, Sonal)

1. Meta Business account under Dockhand Inc. (exists for Dockhand? reuse if so).
2. WhatsApp Business Platform app in developers.facebook.com; add the WhatsApp product.
3. A phone number **not** on any personal WhatsApp: a new SIM, or a virtual number from a provider that permits WhatsApp. Register it to the Cloud API.
4. Display name "Nudged"; business verification for the display name to show and the limits to lift (unverified numbers are capped on business-initiated messages, which Nudged does not send; user-initiated replies are not capped).
5. Webhook URL `https://sdtbdrrcppjeilwhvwbw.supabase.co/functions/v1/whatsapp-webhook`, subscribe to `messages`.
6. Secrets in Supabase: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` (system user token, never expires), `WHATSAPP_PHONE_NUMBER_ID`.
7. Costs: number US$0 to 2/month depending on provider; service-window replies free; Claude about US$0.002 per forwarded message.

## 6. Privacy and policy

- The user sends the message to Nudged on purpose, so processing it is consented. Still, keep the storage promise: the raw body lives in `inbound_messages.body` only until processed (minutes; 24 h worst case on retry), then is nulled. The note keeps a paraphrased clip, the same as email.
- Privacy policy addition: *"If you forward messages to Nudged on WhatsApp or share them from another app, the text is sent to Anthropic's Claude API to find promises and dates, then deleted within 24 hours. Only the resulting note is kept."*
- WhatsApp Business Policy: Nudged replies only to messages the user sent; no marketing, no templates, no lists. The upgrade reply to free users is a response to their message, not an outbound campaign; keep it to one line and send it at most once a day per number.
- App Store 5.1.2(i) consent screen already covers "email text to Claude"; extend its wording to "messages you forward or share".
- Data safety / privacy label: add "Messages: user content, linked to the user" for both stores.

## 7. Plan gating

| | Free | Pro |
|---|---|---|
| Link WhatsApp | Yes (so the upgrade reply can reach them) | Yes |
| Forward a message | Reply with the upgrade line; message discarded | Processed |
| Share-sheet | Sheet shows the upgrade prompt | Processed |

## 8. Mac Messages (plugin, automatic)

For plugin users on a Mac, iMessage and (with Text Message Forwarding on the iPhone) SMS land in `~/Library/Messages/chat.db`, a SQLite file. Reading it needs Full Disk Access for the Claude desktop app, which macOS prompts for once.

- `run` skill, new step 4b (Pro only): run the pre-approved command `sqlite3 -json ~/Library/Messages/chat.db "<query>"` for messages with `ROWID > <last_rowid>` from the last two days, joined to `handle` for the sender, `chat` for the chat name. `last_rowid` stored in `~/.claude/nudged/config.json`. Treat each 1:1 chat's new messages as one "thread" with id `imessage:<chat_identifier>`; group chats are skipped (noise).
- Same extraction, same note shape, `source='imessage'`, `source_url` = `imessage://` link is not reliable; omit, and set `who` from the contact name when `handle` resolves one.
- Silence detection works here (unlike forwarding) because the chat is re-read every run.
- Listing disclosure: "On a Mac, Nudged can also read your Messages (iMessage and SMS) locally if you grant Full Disk Access. Nothing leaves your Mac." The plugin currently uses no shell; this adds one `Bash(sqlite3 …)` allow-list entry, which `setup` must ask for separately and which the directory review will flag. Ship as 1.2.0 after the directory has accepted 1.1.0.

## 9. Android notification listener (later)

`NotificationListenerService` sees incoming SMS and WhatsApp notification text. Google Play allows it with a prominent disclosure when it is core functionality. It never sees sent messages. Build only once there is an Android cohort asking for it; the share-sheet covers Android today.

## 10. Build checklist

- [x] `0004_channels.sql`
- [x] Factor extraction out of `nudged-sync` into `_shared/notes.ts` (prompts, apply, helpers) and `_shared/plan.ts` (plan limits); `nudged-sync` now also honours the free plan (no calendar writes, 30 open notes)
- [x] `whatsapp-webhook`, `ingest`, `channel-link` functions; `_shared/channels.ts` is the one pipeline both use
- [ ] App: Settings → Connect WhatsApp; share-sheet via `expo-share-intent`; WhatsApp badge on notes
- [ ] Meta app, number, webhook, secrets
- [ ] Privacy page and consent screen wording
- [ ] `board.html` and the app board: show `source` badge, hide "Open email" for non-email notes
- [ ] Mac Messages step in `run` (1.2.0)
