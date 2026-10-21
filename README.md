# Nudged

A post-it that travels with you. Free plan plus a Pro subscription, delivered as a Claude Code plugin that runs inside each customer's own Claude with their own Gmail and Google Calendar connections. No customer mail ever touches our servers; the only thing we store is the licence and its billing status.

```
.claude-plugin/marketplace.json      the marketplace listing (this repo IS the marketplace)
plugins/nudged/                     the plugin customers install
  .claude-plugin/plugin.json
  skills/setup/SKILL.md              /nudged:setup  — licence, connectors, board, hourly routine
  skills/run/SKILL.md                /nudged:run    — the hourly routine itself
  skills/board/SKILL.md              /nudged:board  — summary, "watch for X", mark done
  assets/board.html                  the board page, published privately per customer
backend/supabase/                    licence store + Stripe webhook (one small Supabase project)
  migrations/0001_licenses.sql
  functions/license-check/           GET ?key= → {valid, plan, renews, limits}
  functions/free-signup/             POST {email} → free-plan key by email, no Stripe
  functions/stripe-webhook/          Stripe events → issue / update / revoke keys, upgrade free keys, email the key
  migrations/0003_free_plan.sql      plan 'free', one free key per email, signup rate limit
site/index.html                      landing page with the Stripe Payment Link
```

## How a customer experiences it

1. Gets a free key on the site (email only) or subscribes to Pro (Stripe Payment Link, monthly or yearly). Either way a key like `ND-K7Q2-M9XW-4RJP-NC3D` arrives by email. Subscribing later with the same email turns the free key into a Pro key in place.
2. In Claude Code: `/plugin marketplace add nudgedpro-art/nudged`, then `/plugin install nudged@nudged`.
3. In the Claude desktop app's Code tab, `/nudged:setup` checks the key, confirms Gmail and Calendar are connected, publishes their private board, pre-approves the routine's tools, and creates the hourly routine `nudged-hourly`. One Run now click records the approvals.
4. Every hour the routine loads `nudged:run`, which checks the licence first and applies the plan's limits: Free reads one mailbox, keeps up to 30 open notes and nudges on the board; Pro adds calendar events and drafted follow-ups. A cancelled Pro key keeps working on the free plan.

## Launch checklist (in order)

1. **Stripe (new account).** Create a product "Nudged" with a monthly price (and optionally yearly). Create a Payment Link in subscription mode that collects email. Enable the Customer Portal. Note the Payment Link URL and the portal URL.
2. **Supabase.** Own organisation "Nudged" (free plan), project `nudged` (`sdtbdrrcppjeilwhvwbw`, ca-central-1). Tables `licenses` and `stripe_events`, functions `license-check` and `stripe-webhook` (both `verify_jwt=false`). Secrets, set in the dashboard under Edge Functions → Secrets: `STRIPE_WEBHOOK_SECRET` (live webhook endpoint) and optionally `STRIPE_WEBHOOK_SECRET_TEST` (sandbox endpoint), `RESEND_API_KEY` (Nudged's own Resend account, domain nudged.pro), `FROM_EMAIL`. No Stripe API key is needed.
3. **Stripe webhook.** Endpoint `https://sdtbdrrcppjeilwhvwbw.supabase.co/functions/v1/stripe-webhook`, events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Paste the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Resend.** Verify the sending domain for `FROM_EMAIL`.
5. **Fill the placeholders.** `STRIPE_PAYMENT_LINK` and `STRIPE_CUSTOMER_PORTAL_LINK` in `site/index.html`,.
6. **Publish.** Push this repo to a public GitHub repo (the plugin files must be readable to install). Host `site/` on Netlify.
7. **Test end to end** with a Stripe test-mode checkout: key arrives → `/nudged:setup` on a second Claude account → first run seeds a board.

## 1.1.0 rollout (free plan and drafts), in order

1. **Database.** Apply `migrations/0003_free_plan.sql` to project `sdtbdrrcppjeilwhvwbw`.
2. **Functions.** Deploy `license-check` and `stripe-webhook` (changed) and `free-signup` (new, `verify_jwt=false`). Add secret `SITE_ORIGIN=https://nudged.pro` (CORS for the signup form).
3. **Stripe.** Add a yearly price (CA$90, 14-day trial) to the Nudged product and a Payment Link for it; paste its URL over `STRIPE_YEARLY_PAYMENT_LINK` in `site/index.html`. The webhook already maps `interval: year` to `plan: yearly`.
4. **Site.** Deploy `site/` (Netlify). Test the free form with a throwaway address: key email arrives, `/nudged:setup` reports "Free plan", a run creates notes with `pro_hint` and no calendar events.
5. **Upgrade path.** Subscribe with that same address in Stripe test mode: the webhook should upgrade the existing row (no second key), the "now Pro" email arrives, and the next run creates calendar events and drafts.
6. **Plugin.** Tag 1.1.0; existing installs pick it up on their next `/plugin update`. Resubmit to the directory with the new disclosure (drafts, never sends).

## Things that are deliberately not here

- No app, no servers reading mail, no Google OAuth verification. That is the hosted version, later, if the plugin proves people pay.
- No DRM beyond the licence check. A prompt can be copied; the subscription buys the board, resolution quality, new channels, updates and support.
- The plan gates live in the licence server's `limits` response, not in the skill, so a plan change never needs a plugin release.

Product model and roadmap: `docs/product-model.md`. Channels beyond email (WhatsApp, texts, Mac Messages): `docs/forward-to-nudged.md`.
