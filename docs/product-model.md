# Nudged product model

Written 2026-10-21. Companion to `launch-plan.md` (which covers launch mechanics, store rules and Google verification). This document says what Nudged is, what is free, what is paid, which channels it watches, and the order to build in. Owner: Sonal Agarwal.

## 1. What Nudged is

A post-it that travels with you. Nudged notices promises and dated plans in the user's messages, keeps one living note per item on a board, puts confirmed items on the calendar, and nudges the user when a thread goes quiet. It never sends anything on its own.

Two delivery paths share one licence store and one note shape:

| | Plugin (live, 1.0.1) | Hosted app (built, unreleased) |
|---|---|---|
| Runs where | Inside the customer's own Claude, hourly, while the desktop app is open | Supabase Edge Functions, polling every 15 min (Gmail push later) |
| Mail access | The customer's own Gmail and Calendar connectors; no mail on Nudged servers | Google OAuth (`gmail.readonly`, `calendar.events`); refresh tokens in Vault |
| Front end | Private Artifact board (`plugins/nudged/assets/board.html`) | Expo app (`app/`) and web board at `/app` |
| Needs | Paid Claude plan, Code tab, about 25 minutes of setup | Google sign-in |
| Gate | Licence key `ND-…` checked before every run | `licenses` row matched by email |
| Status | Selling at CA$9/month, 14-day trial, Stripe live | Blocked on Google verification, store accounts, M2 leftovers |

One run of the routine: licence check → re-read watched threads → scan the last two days of human mail → extract commitments and events → match to existing notes → create or update calendar events → nudge on silence (expected date passed, or five quiet days) → label messages seen.

Deliberate limits, kept in every tier: never send, reply, forward, archive or delete email; never delete a calendar event; never modify a calendar event Nudged did not create; never delete a note.

## 2. The model: free notices, paid acts

Calendly's split applied to Nudged. The free tier does the whole core job for one person; paying buys action, breadth and reach. For the plugin, a free user costs Nudged almost nothing (the customer's own Claude does the work; Nudged serves one licence check an hour). For the app, a free user costs roughly US$0.05 to 0.20 a month in Claude API calls, which the paid tier covers many times over.

### Free — "Nudged notices"

- One mailbox (Gmail), hourly scan, the board, nudges on the board
- 2-day lookback, **30 open notes** (pending or scheduled); past that, the run stops creating and the board says why
- Calendar: read-only. Confirmed items show "Would go on calendar on Pro" instead of an event
- No drafts, no digest, no push, no outputs

### Pro — CA$9/month or CA$90/year — "Nudged acts"

Everything in Free, plus:

- **Calendar writes.** Confirmed items become events and are kept current (today's behaviour)
- **Drafted chases.** When a nudge fires, Nudged writes a Gmail draft of the follow-up from the clips and puts an "Open draft" button on the note. The user reads, edits, sends. Nudged still never sends
- **Daily digest** (app first; plugin via the morning calendar event): "3 need you, 2 waiting on them"
- **Push notifications** (app) when a nudge fires or a date is confirmed
- **Unlimited notes**, 30-day lookback on install, history and search
- **Forward-to-Nudged**: WhatsApp, SMS, iMessage, anything, by forwarding or sharing a message (see §3 and `forward-to-nudged.md`)
- **Second mailbox** (Outlook/M365 first; app only)
- **Outputs**: Todoist, Slack, webhook

### Team — about CA$15 per seat per month — "Nudged for the business" (later, after M4)

- Shared boards: owner and assistant, host and cleaner, a couple running a cottage
- Assign a note to a seat; "waiting on them" visible to everyone on the board
- Per-seat billing, as Calendly Teams

### Licence rows

`licenses.plan` is one of `free | monthly | yearly` (Team adds `team` with a seat count later). `license-check` returns the plan and the limits the skill should apply, so the plugin never hard-codes a limit:

```json
{ "valid": true, "plan": "free", "renews": null, "message": "Free plan",
  "limits": { "open_notes": 30, "lookback_days": 2, "calendar_writes": false, "drafts": false } }
```

A free key is issued by `free-signup` (email only, no Stripe). When that email later checks out on Stripe, the webhook upgrades the same row to `monthly` or `yearly` so the key the user already pasted keeps working; nothing to reinstall.

## 3. Channels

Email is the only channel anyone can read in the background. WhatsApp has no API for personal chats, iOS exposes nothing of Messages, and Google Play grants SMS reading only to default SMS apps. So Nudged reads email on its own and takes everything else by hand-off.

| Channel | Mode | How | Limit |
|---|---|---|---|
| Gmail | Automatic | Connector (plugin) or OAuth (app) | — |
| Outlook / M365 | Automatic (app, Pro) | Graph API, same shape as Gmail | App only |
| WhatsApp | Forward | User forwards a message to Nudged's WhatsApp Business number; Nudged extracts and replies "Got it" | Only what they forward; no silence detection on the other side |
| WhatsApp, SMS, iMessage, Signal, anything | Share | Share-sheet into the Nudged app (`expo-share-intent`) | Manual, one message at a time |
| iMessage and SMS on a Mac | Automatic (plugin) | Read `~/Library/Messages/chat.db` locally; with Text Message Forwarding on, iPhone SMS land there too | Mac only; adds a local read step to disclose in the listing |
| SMS on Android | Semi-automatic, incoming only | Notification listener permission | Never sees what the user sent; Play needs a prominent disclosure |
| SMS via Google Voice | Automatic, zero build | Google Voice forwards texts to Gmail | Google Voice users only |
| WhatsApp chat export | Backfill | "Export chat" → .txt → share to Nudged | One-off |

Product copy for the hand-off channels, said plainly: *Nudged watches your email on its own. For anything else, flick it a message.* A forwarded message loses its thread, so Nudged holds the promise and nudges the user, but cannot see whether the other side replied.

Order: Forward-to-Nudged and share-sheet first (one ingestion path, every channel, store-safe), Mac Messages for the plugin second, Android notification listener once there is an Android cohort.

## 4. How each enhancement moves subscribers

| Enhancement | Lever | Where it lands |
|---|---|---|
| Free tier | Top of funnel; removes the trial cliff | `free-signup` function; plan gates in `run` |
| Drafted chase + "Open draft" | The conversion moment: the thing people pay to keep | `run` skill (`create_draft`); app via Gmail API |
| Footer on sent chases ("noticed by Nudged") | The only outward-facing surface; Calendly's "Powered by" | One line in the draft |
| Daily digest | Retention without opening the board | App backend (Resend); plugin via a morning calendar event |
| Hosted sign-up | Removes the paid-Claude and Code-tab ceiling | Track B M2 to M4 |
| Annual at two months free | Churn | Stripe yearly price; `plan: yearly` already handled |
| Forward-to-Nudged | Reaches the people who text, not email | `forward-to-nudged.md` |
| Outlook/M365 | Roughly doubles the addressable market | App backend |
| Team seats | Expansion revenue | App backend, after M4 |
| Referral (a month for a month) | Cheap acquisition | `licenses` plus webhook |

## 5. Build order

1. **This week, plugin side, no Google clock:** free tier (licence server, `free-signup`, plan gates in `run`), drafted chases on nudges, "Open draft" on the board, yearly price in Stripe, site copy. Ships as plugin 1.1.0.
2. **Next:** Forward-to-Nudged WhatsApp number and the share-sheet in the app (Track B M2), both feeding the same `notes` table.
3. **Then back onto Track B** as planned in `launch-plan.md`: Google verification is the long pole, so the demo video and scope submissions go in before anything else is polished.
4. **After the first paying cohort:** Mac Messages for the plugin, daily digest, Outlook, then Team.

## 6. Open questions

- Free plan on the plugin still needs a paid Claude plan. That is Anthropic's gate, not ours; the copy should say so rather than hide it.
- Whether free users get the 2-day or a 1-day lookback. Start at 2 (same as today) and tighten only if free runs crowd the limits.
- Digest on the plugin: a calendar event at 7am is the only push-like surface the plugin has; test whether people read it before building more.
