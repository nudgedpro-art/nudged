# Changelog

## 1.1.0 — 2026-10-21

Free plan and drafted follow-ups.

- Free plan: one Gmail account, the board, nudges, up to 30 open notes, no calendar writes. Keys issued from nudged.pro without a card (`free-signup`). A free key becomes a Pro key when the same email subscribes; nothing to reinstall.
- Pro: when a nudge fires, Nudged writes a Gmail draft of the follow-up as a reply on the thread and the note gets an "Open drafted follow-up" button. Nudged still never sends.
- Licence check now returns `plan` and `limits`; the run skill applies them instead of hard-coding behaviour. A cancelled subscription falls back to the free plan rather than a dead key.
- Board: Pro hints on free-plan notes ("On Pro this would be on your calendar"), a full-board notice at the limit.
- Yearly price (CA$90) on the site. Docs: `product-model.md`, `forward-to-nudged.md`.

## 1.0.1 — 2026-10-09

- Skills no longer use a shell: config is read with Read, the licence check uses WebFetch, setup writes files with Write. Removes the pre-approved shell commands the directory flags.
- Listing icon added.


## 1.0.0 — 2026-10-09

First paid release.

- Billing live: Stripe subscription (14-day trial, CA$9/month incl. HST) sold by Dockhand Inc.; licence key emailed on checkout.
- Licence server: race-safe key issue when Stripe's checkout and subscription events arrive together; events are only marked handled after success so a failed send is retried; live and sandbox endpoints both verify; works with Stripe API versions before and after 2025-03-31.
- nudged.pro: live Subscribe link, manage-subscription link, seller and HST details.


## 0.1.0 — 2026-10-09

First working version.

- Skills: `/nudged:setup`, `/nudged:run`, `/nudged:board`.
- Hourly routine created by setup; runs inside your own Claude desktop app.
- Private board page with live notes, filters, done/dismiss, "watch for" input.
- Commitments and dated plans extracted from the last two days of Gmail; confirmed ones become calendar events marked "— Nudged,"; nudges when a thread goes quiet.
- Messages are labelled individually once read, so a later reply on any thread is still noticed.
- Licence check against nudged.pro before every run, with a three-day grace period on failed renewals.
