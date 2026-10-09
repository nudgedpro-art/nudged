# Changelog

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
