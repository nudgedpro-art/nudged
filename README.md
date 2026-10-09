# Nudged

A post-it that travels with you. Sold as a subscription, delivered as a Claude Code plugin that runs inside each customer's own Claude with their own Gmail and Google Calendar connections. No customer mail ever touches our servers; the only thing we store is the licence and its billing status.

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
  functions/license-check/           GET ?key= → {valid, plan, renews}
  functions/stripe-webhook/          Stripe events → issue / update / revoke keys, email the key
site/index.html                      landing page with the Stripe Payment Link
```

## How a customer experiences it

1. Subscribes on the site (Stripe Payment Link). The webhook issues a key like `ND-K7Q2-M9XW-4RJP-NC3D` and emails it.
2. In Claude Code: `/plugin marketplace add <github-owner>/nudged`, then `/plugin install nudged@nudged`.
3. `/nudged:setup` checks the key, confirms Gmail and Calendar are connected, publishes their private board, and creates the hourly routine `nudged-hourly`.
4. Every hour the routine loads `nudged:run`, which checks the licence first and then does the work. A lapsed key stops the routine with a clear message.

## Launch checklist (in order)

1. **Stripe (new account).** Create a product "Nudged" with a monthly price (and optionally yearly). Create a Payment Link in subscription mode that collects email. Enable the Customer Portal. Note the Payment Link URL and the portal URL.
2. **Supabase.** Own organisation "Nudged" (free plan), project `nudged` (`sdtbdrrcppjeilwhvwbw`, ca-central-1), entirely separate from Dockhand. Tables `licenses` and `stripe_events`, functions `license-check` and `stripe-webhook` (both `verify_jwt=false`). Secrets, set in the dashboard under Edge Functions → Secrets: `STRIPE_WEBHOOK_SECRET` (from the Stripe webhook endpoint), `RESEND_API_KEY` (Nudged's own Resend account, domain nudged.pro), `FROM_EMAIL`. No Stripe API key is needed.
3. **Stripe webhook.** Endpoint `https://sdtbdrrcppjeilwhvwbw.supabase.co/functions/v1/stripe-webhook`, events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Paste the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Resend.** Verify the sending domain for `FROM_EMAIL`.
5. **Fill the placeholders.** `STRIPE_PAYMENT_LINK` and `STRIPE_CUSTOMER_PORTAL_LINK` in `site/index.html`, and the GitHub owner in the webhook's email text and the README.
6. **Publish.** Push this repo to a public GitHub repo (the plugin files must be readable to install). Host `site/` on Netlify.
7. **Test end to end** with a Stripe test-mode checkout: key arrives → `/nudged:setup` on a second Claude account → first run seeds a board.

## Things that are deliberately not here

- No app, no servers reading mail, no Google OAuth verification. That is the hosted version, later, if the plugin proves people pay.
- No DRM beyond the licence check. A prompt can be copied; the subscription buys the board, resolution quality, new channels, updates and support.
