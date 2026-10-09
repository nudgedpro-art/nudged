# Travelling Post-its

A post-it that travels with you. Sold as a subscription, delivered as a Claude Code plugin that runs inside each customer's own Claude with their own Gmail and Google Calendar connections. No customer mail ever touches our servers; the only thing we store is the licence and its billing status.

```
.claude-plugin/marketplace.json      the marketplace listing (this repo IS the marketplace)
plugins/postits/                     the plugin customers install
  .claude-plugin/plugin.json
  skills/setup/SKILL.md              /postits:setup  — licence, connectors, board, hourly routine
  skills/run/SKILL.md                /postits:run    — the hourly routine itself
  skills/board/SKILL.md              /postits:board  — summary, "watch for X", mark done
  assets/board.html                  the board page, published privately per customer
backend/supabase/                    licence store + Stripe webhook (one small Supabase project)
  migrations/0001_licenses.sql
  functions/license-check/           GET ?key= → {valid, plan, renews}
  functions/stripe-webhook/          Stripe events → issue / update / revoke keys, email the key
site/index.html                      landing page with the Stripe Payment Link
```

## How a customer experiences it

1. Subscribes on the site (Stripe Payment Link). The webhook issues a key like `TP-K7Q2-M9XW-4RJP-NC3D` and emails it.
2. In Claude Code: `/plugin marketplace add <github-owner>/travelling-postits`, then `/plugin install postits@travelling-postits`.
3. `/postits:setup` checks the key, confirms Gmail and Calendar are connected, publishes their private board, and creates the hourly routine `postits-hourly`.
4. Every hour the routine loads `postits:run`, which checks the licence first and then does the work. A lapsed key stops the routine with a clear message.

## Launch checklist (in order)

1. **Stripe (new account).** Create a product "Travelling Post-its" with a monthly price (and optionally yearly). Create a Payment Link in subscription mode that collects email. Enable the Customer Portal. Note the Payment Link URL and the portal URL.
2. **Supabase (new project).** Apply `backend/supabase/migrations/0001_licenses.sql`. Deploy both functions with `verify_jwt=false`. Set secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `FROM_EMAIL`.
3. **Stripe webhook.** Endpoint `https://<project>.supabase.co/functions/v1/stripe-webhook`, events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Paste the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Resend.** Verify the sending domain for `FROM_EMAIL`.
5. **Fill the placeholders.** `LICENSE_ENDPOINT` in `skills/setup/SKILL.md` and `skills/run/SKILL.md` (→ `<project>.supabase.co/functions/v1`), `STRIPE_PAYMENT_LINK` and `STRIPE_CUSTOMER_PORTAL_LINK` in `site/index.html`, and the GitHub owner in the webhook's email text and the README.
6. **Publish.** Push this repo to a public GitHub repo (the plugin files must be readable to install). Host `site/` on Netlify.
7. **Test end to end** with a Stripe test-mode checkout: key arrives → `/postits:setup` on a second Claude account → first run seeds a board.

## Things that are deliberately not here

- No app, no servers reading mail, no Google OAuth verification. That is the hosted version, later, if the plugin proves people pay.
- No DRM beyond the licence check. A prompt can be copied; the subscription buys the board, resolution quality, new channels, updates and support.
