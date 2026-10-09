# Nudged

A post-it that travels with you. Nudged reads your Gmail for commitments ("we'll deliver Friday") and dated plans ("cottage weekend Oct 10–12"), keeps one living note per item on a private board in your own Claude account, puts confirmed plans on your Google Calendar, folds in every follow-up, and nudges you when the other side goes quiet.

Website: https://nudged.pro · Support: hello@nudged.pro · Sold by Dockhand Inc., Ontario, Canada.

## Skills

- `/nudged:setup` — checks your licence key, confirms Gmail and Google Calendar are connected, publishes your private board page, pre-approves the tools the routine needs (with your permission), and creates the hourly routine `nudged-hourly`.
- `/nudged:run` — one run of the routine. Invoked hourly by the routine; you can also run it by hand.
- `/nudged:board` — a summary of what is on the board, "watch for X", and "done with X".

## What it reads, writes, and sends

**Reads (through your own Claude connectors, never through our servers)**
- Gmail: threads from the last two days, excluding promotions, social and forum mail, plus threads already attached to an open note. Read with `search_threads` and `get_thread`.
- Google Calendar: the primary calendar id and timezone, and events the routine created.

**Writes**
- Gmail: adds a hidden label (`Nudged/Seen`) to each message it has read, so nothing is read twice. It never sends, replies to, forwards, archives, trashes or marks spam.
- Google Calendar: creates and updates events for confirmed plans. Every event it writes carries "— Nudged," in its description and it only ever edits those. It never deletes an event.
- Your board: an Artifact page published in your own Claude account with a small database (collection `postits`). Notes hold names, paraphrased summaries, dates, places and Gmail thread ids. This data stays in your Claude account.
- Your machine: `~/.claude/nudged/config.json` (licence key, board URL, calendar id, connector prefixes) and, if you agree during setup, entries in `~/.claude/settings.json` under `permissions.allow`.

**Sends off-platform (the only external call)**
- Before each run, and once during setup, the plugin fetches `https://sdtbdrrcppjeilwhvwbw.supabase.co/functions/v1/license-check?key=<your licence key>` over HTTPS. The request contains the licence key and nothing else. Our server records the time of the check and a count. No email, calendar or board content is ever sent.

## What our service stores

Licence key, the email address given to Stripe at checkout, plan and billing status, Stripe customer and subscription ids, and the time and count of licence checks. Kept while the subscription is active and for 12 months after it ends. Privacy policy: https://nudged.pro/privacy.html · Terms: https://nudged.pro/terms.html

## Requirements

A Claude plan with the desktop app and Claude Code, with the Gmail and Google Calendar connectors enabled. The routine runs while the desktop app is open. CA$9/month after a 14-day free trial, HST included; subscribe at https://nudged.pro.
