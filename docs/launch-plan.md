# Nudged launch plan

Written 2026-10-09 from the research pack and verification pass. Where a research claim was refuted, this plan uses the corrected version and says so. Owner: Sonal Agarwal. Nothing here touches Dockhand.

## 1. Decisions Sonal must make

**D1. Keep the plugin as the first paid product, before any app.**
The plugin works, holds no customer mail (Anthropic's connectors do the reading), and needs no Google verification. The app needs a Gmail-reading backend, a security assessment, two developer accounts and store review: 3 to 4 months before the first dollar. Recommendation: launch the plugin in October, use its first 30 days of paying users to decide whether the app is worth building.

**D2. Plugin pricing mechanism: licence key checked by the skill (as built) vs a remote MCP connector that checks the subscription server-side.**
The licence-key check runs on the customer's machine and can be read or bypassed; a remote connector is harder to bypass but means Nudged's server sits in the data path, which undoes the "no mail on our servers" promise. Recommendation: keep the key check. The subscription buys the board, updates and support, not DRM. Revisit only if piracy is visible.

**D3. Distribution: Anthropic directory vs self-hosted GitHub marketplace.**
The directory gives reach across claude.ai, Cowork and Claude Code but a human review with no published duration (the "1 to 4 weeks" figure in the research is an estimate, not sourced; corrected). The self-hosted marketplace is live the moment the repo is public, but customers must paste a `/plugin marketplace add` command. Recommendation: do both. Self-hosted the day the Stripe secrets are set; submit to the directory the same week and treat approval as upside.

**D4. iOS monetization: the research's "free companion app, sell only on the web" model was REFUTED.**
Apple 3.1.3(f) is enforced as an exhaustive list (VoIP, cloud storage, email services, web hosting) and App Review has rejected companion SaaS apps under it; 3.1.3(b) lets web-paid users sign in only if the same subscription is also sold in-app; 3.1.3(c) says consumer single-user sales must use in-app purchase. The verifier also refuted the "entitlement from a paid account is enough" fix (documented rejections Dec 2025 and May 2026). Recommendation: sell the subscription in-app on both stores (StoreKit 2 and Play Billing via RevenueCat) at the same CAD 9, keep Stripe on the web, and let the backend merge all three into one entitlement. Cost: about 15% store take instead of about 6% on Stripe. Alternative if you refuse the 15%: make the mobile app feature-identical for free and paid users (no gating at all), which makes it a loss leader.

**D5. Gmail access path for the app: restricted scope with CASA vs user-configured forwarding.**
`gmail.readonly` (the only read scope; `gmail.metadata` is also restricted and cannot search) requires OAuth verification plus an annual CASA assessment, 6 to 10 weeks and about US$700 to 900 a year, and caps you at 100 lifetime users until approved. Forwarding (user sets a Gmail filter to forward to a Nudged inbox) needs only the sensitive `calendar.events` scope, about a week, no CASA, but sees incoming mail only, so promises the user made in sent mail and "silence on threads I started" are invisible, and Nudged then stores copies of mail. Recommendation: restricted scope. Silence detection is the product; forwarding breaks it. Start verification first because it is the long pole.

**D6. Legal entity and developer accounts.** RESOLVED 2026-10-09: Nudged is sold by Dockhand Inc. (existing Ontario corporation); the Stripe live account reuses its verified entity. D-U-N-S and store enrolment go under Dockhand Inc.
Apple 5.1.1(ix) says apps handling sensitive user information should be submitted by a legal entity, and organisation enrolment needs a D-U-N-S number; an individual account is faster but carries a reviewer-discretion risk. Google Play personal accounts created after Nov 2023 must run a 12-tester, 14-day closed test before production. Recommendation: incorporate Nudged (or register a legal entity) in Ontario, get a D-U-N-S, enrol both stores as an organisation. Budget 2 to 3 weeks for the D-U-N-S.

**D7. Free tier.**
Both stores require the app to do something on first launch without paying. Recommendation: a 14-day full trial, server-side, one `licenses` row per Google account email, shared by plugin and app. After the trial, show the in-app subscription (allowed once IAP exists). On the web, the Stripe Payment Link stays.

**D8. Models.** Use the cheapest current Haiku (`claude-haiku-4-5-20251001` at the time of writing) for the is-this-human-mail triage and the current Sonnet (`claude-sonnet-5`) for extraction only when Haiku flags a message. Re-check model ids and prices on docs.claude.com before M1; the research pass produced ids that could not be confirmed.

## 2. Track A: launch the Claude plugin

Owner in brackets. "Done" means proven on 2026-10-09.

1. [Done] Plugin skills (`setup`, `run`, `board`) and `board.html` proven end to end on the owner's account.
2. [Done] Supabase project `sdtbdrrcppjeilwhvwbw` with `licenses`, `stripe_events`, `license-check`, `stripe-webhook` (`verify_jwt=false`).
3. [Done] Stripe test-mode product, CAD 9/month price, Payment Link. nudged.pro bought; landing on Netlify.
4. [Done 2026-10-09] Point nudged.pro DNS at the Netlify site and verify it in Google Search Console. Needed for Track B too.
5. [Done 2026-10-09] Create the Resend account for nudged.pro, verify the domain, set `RESEND_API_KEY`, `FROM_EMAIL`, `STRIPE_WEBHOOK_SECRET` in Supabase Edge Function secrets.
6. [Done 2026-10-09] Register the Stripe webhook endpoint for the five events in the README; enable the Customer Portal; copy the Payment Link and portal URLs.
7. [Done 2026-10-09] Fill `STRIPE_PAYMENT_LINK` and `STRIPE_CUSTOMER_PORTAL_LINK` in `site/index.html`; add the 14-day trial to the Stripe price and the webhook so a trialing subscription issues a key.
8. [Done 2026-10-09] Update `site/privacy.html` on nudged.pro: name Gmail and Google Calendar as read through the customer's own Claude connectors, state that Nudged stores only licence and billing status, include the Google Limited Use sentence now so the same page serves Track B.
9. [Done 2026-10-09] Run `claude plugin validate --strict ./plugins/nudged`; bump `plugin.json` to 1.0.0; `.claude-plugin/marketplace.json` exists at the repo root and passes `claude plugin validate` (done 2026-10-09).
10. [Done 2026-10-09] Create the public repo nudgedpro-art/nudged and push (required for both self-hosted install and directory go-live).
11. [Done 2026-10-09] End-to-end test: Stripe test checkout, key email arrives, `/nudged:setup` on a second Claude account, first hourly run seeds a board; then uninstall, reinstall, confirm the licence gate fires on a revoked key.
12. [Done 2026-10-09] Flip Stripe to live mode; set the live webhook secret.
13. [Sonal, 1 h] Submit at claude.ai/directory/manage (needs a paid plan; data-handling questionnaire and four acknowledgements; 10 submissions per org per 24 h). Review time is not published. Corrected from the research: scheduled tasks are a Cowork feature, not a plugin component, and since 2026-10-06 they run remotely by default. Nudged uses no local MCP server, so this is fine; the listing should say "runs as a Cowork scheduled task or Claude Code routine".
14. [Sonal] Announce by email and on nudged.pro. Pricing talk belongs on the web and in email, never inside the future mobile app outside the US storefront.

Track A is LIVE as of 2026-10-09 (steps 1 to 12). Remaining: 13 (directory submission) and 14 (announce), both Sonal. Note on 11: the revoked-key gate and a second-account setup were not exercised; the live purchase test was skipped by decision.

## 3. Track B: the consumer app

**Architecture (from the architecture research; the model names corrected).** Expo / React Native with expo-router, EAS Build and Submit, on the existing Supabase project. Supabase Edge Functions do all Gmail, Calendar and Claude work, triggered by Gmail push (Pub/Sub `users.watch`, which needs no extra scope). Google refresh tokens live in Supabase Vault, reachable only through a SECURITY DEFINER RPC; access tokens are minted per job and never stored. Store only extracted items (who, what, expected date, thread ids), never message bodies; this shortens CASA and the data-safety forms. Push via Expo's free service; share-sheet ingestion via `expo-share-intent`. `board.html` is rewritten as native screens, because it is written against the Artifact db and a WebView wrapper risks Apple 4.2. Google OAuth through the system browser (AppAuth), never a WebView. Scopes: exactly `gmail.readonly` and `calendar.events`.

**Monetization structure that passes review (corrected).**
- iOS: StoreKit 2 auto-renewable subscription, CAD 9/month, at least 7 days, clearly described before purchase (3.1.2(a)). Enrol in the Small Business Program for 15%. Web-paid and plugin users sign in and are honoured under 3.1.3(b) because the same subscription is also sold in-app. No licence-key field anywhere in the app (3.1.1). No link to nudged.pro pricing in the app or its App Store text outside the US storefront.
- Android: Play Billing subscription at the same price. Google's fee is 15% in Canada and rest-of-world; 10% plus 5% billing in US, UK, EEA.
- Web: Stripe stays, about 6%.
- RevenueCat (free under US$2.5k monthly revenue) normalises the three sources; its webhook writes the `licenses` row.
- Do not build the US-only external-link variants (Apple US storefront, Google External Content Links). The Supreme Court granted certiorari in Apple v. Epic on 30 June 2026; the ground moves.

**Consent and privacy requirements, all blocking.**
- Two explicit in-app consent screens: Gmail prominent disclosure before the OAuth prompt (Google Play User Data policy), and a separate "Nudged sends relevant email text to Anthropic's Claude API; nothing is used to train AI" permission before the first extraction (Apple 5.1.2(i), added Nov 2025).
- Sign in with Apple alongside Google (about one day; removes the 4.8 risk rather than arguing exception (v)).
- In-app account deletion that revokes the Google token and deletes all rows, plus a web deletion URL (Google), with a note to cancel the subscription first.
- Privacy policy on nudged.pro naming Gmail, Google Calendar, Supabase, Anthropic as processor under Commercial Terms that forbid training, retention and deletion, the exact Limited Use sentence ("The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements."), and the commitment not to retain Workspace data to train non-personalised AI models.
- Apple privacy label: User Content (emails), Contact Info, Identifiers, all linked to the user, including data handled by the AI vendor. Play Data safety: declare as collected, not shared (processors are not "sharing").

**Google verification path, cost and timeline.**
1. Brand verification: homepage on nudged.pro (store links do not count), privacy policy on the same domain, domain verified in Search Console. 2 to 3 business days.
2. Sensitive scope (`calendar.events`): demo video plus justification. 3 to 5 business days.
3. Restricted scope (`gmail.readonly`): same submission; Google says "several weeks", practitioners report about 6. Expect one rejection round; keep branding, scopes in code, consent screen and video identical.
4. CASA: mandatory because the backend stores and transmits restricted data. Google assigns AL1 or AL2; every small-app report says AL1. Book TAC Security Tier 2 Basic (list US$675, reports of US$540; Premium US$855). Leviathan is US$3,000 to 6,000 and not needed. Pre-run OWASP ZAP and a DAST scan so the Letter of Assessment lands in days. Renew every 12 months; set a reminder at month 10.
5. Until approved: 100 test users with 7-day consent expiry in Testing, or 100 lifetime users unverified in Production. Use a separate Google Cloud project for any experiments so the production project's cap is never burned.

Total: 6 to 10 weeks from first submission for a prepared solo founder; plan 3 months. Undocumented: how long after approval Google allows to finish CASA, and the AL1/AL2 thresholds.

**Milestones.**
- M0 (week 1): D-U-N-S application, entity, Apple and Google developer accounts, nudged.pro DNS and privacy policy, Google Cloud project, brand verification submitted.
- M1 (weeks 2 to 4): backend: `profiles`, `google_connections`, `notes`, Vault token storage, Gmail watch, Haiku triage plus Sonnet extraction, Calendar write, silence detection, deletion endpoint. Web demo flow recorded for the Google video; sensitive and restricted scope submissions sent.
- M2 (weeks 4 to 7): Expo app: onboarding with both consent screens, Google and Apple sign-in, board, item detail, push, share sheet, settings with delete account, RevenueCat paywall. TestFlight and a Play closed test (12 testers for 14 days if still on a personal account).
- M3 (weeks 7 to 10): CASA scan, fix, SAQ, LOA. App Store and Play submissions. Expect one rejection each; answer with the IAP already in place.
- M4 (weeks 10 to 14): public release once Google restricted approval and store approvals coincide.

## 4. Costs and calendar

| Item | One-time | Monthly | Note |
|---|---|---|---|
| Apple Developer Program | US$99/yr | | Organisation needs D-U-N-S (free, 2 to 3 weeks) |
| Google Play developer | US$25 | | ID and card in legal name |
| Ontario incorporation (if chosen) | ~CAD 300 to 400 | | Optional for D6 |
| CASA AL1 (TAC) | | ~US$60 (US$675 to 855/yr) | Recurs every 12 months |
| Supabase | | US$0 to 25 | Free tier until real load |
| Claude API | | ~US$0.05 to 0.20 per active user | Haiku triage, Sonnet on hits; measure in M1 |
| Resend | | US$0 to 20 | |
| Netlify, domain | | ~US$2 | Domain already bought |
| RevenueCat | | US$0 | Free under US$2.5k MTR |
| Expo EAS | | US$0 | 15 iOS and 15 Android builds a month free |
| Store take | | 15% of in-app revenue | Stripe web about 6% |

At CAD 9, in-app selling costs about CAD 1.35 per subscriber-month versus about CAD 0.56 on Stripe. Below roughly 150 subscribers the fixed costs above dominate, not the commission.

**Calendar.** Week of Oct 12: Track A steps 4 to 12, plugin live on the self-hosted marketplace; directory submitted. Oct 19: D-U-N-S, entity, developer accounts, Google brand verification. Oct 26 to Nov 13: backend and Google submissions. Nov 16 to Dec 4: app, TestFlight, closed test. Dec 7 to Dec 23: CASA and store submissions. Mid-January 2027: public app release. Google restricted-scope approval gates everything after submission.

## 5. Risks, ranked

1. **Apple rejects the subscription model.** Mitigated by selling in-app from day one (D4). Residual: reviewers may still cite 3.1.1 if any web-pricing text leaks into the app or metadata; keep the app silent on price outside the paywall.
2. **Google restricted-scope rejection rounds or AL2 assignment.** Mitigated by byte-identical submission materials, storing no bodies, one restricted scope only. AL2 would cost US$3,600 or more; unlikely at launch scale.
3. **No paying demand for the plugin.** Mitigated by D1: measure 30 days before funding Track B. Install friction (marketplace command, paid Claude plan) will show in the first cohort.
4. **Licence key bypass on the plugin.** Accepted (D2). The key gates the board, updates and support.
5. **Limited Use and AI processing.** Mitigated by naming Anthropic as processor with no-training terms in the policy. Open: whether an assessor wants Anthropic's zero-data-retention option; ask at CASA scoping.
6. **5.1.1(ix) individual-submitter risk.** Mitigated by organisation enrolment (D6).
7. **CASA lapse after 12 months** removes Gmail access for every user. Calendar reminder at month 10; budget the renewal.
8. **Anthropic changes plugin, directory or scheduled-task rules.** Fallback is the self-hosted marketplace and the Claude Code routine.
9. **Google Play 12-tester rule** delays Android if enrolling as an individual. Organisation account is believed exempt but unconfirmed; recruit 12 testers anyway in M2.

## 6. Sources

- https://claude.com/docs/directory/publish
- https://claude.com/docs/plugins/platform-support
- https://claude.com/docs/plugins/overview
- https://code.claude.com/docs/en/plugins/publish.md
- https://support.claude.com/en/articles/13854387 (scheduled tasks)
- https://developer.apple.com/app-store/review/guidelines/ (3.1.1, 3.1.2, 3.1.3, 4.2, 4.8, 5.1.1, 5.1.2)
- https://developer.apple.com/forums/thread/781935 ; /thread/811018 ; /thread/825551 (3.1.3(f) and account-entitlement rejections)
- https://developer.apple.com/app-store/small-business-program/
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://developer.apple.com/app-store/app-privacy-details/
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.storekit.custom-purchase-link.allowed-regions
- https://support.google.com/googleplay/android-developer/answer/10281818 (Payments)
- https://support.google.com/googleplay/android-developer/answer/112622 (service fees)
- https://support.google.com/googleplay/android-developer/answer/9888170 (User Data)
- https://support.google.com/googleplay/android-developer/answer/10787469 (Data safety)
- https://support.google.com/googleplay/android-developer/answer/13327111 (account deletion)
- https://support.google.com/googleplay/android-developer/answer/14151465 (closed testing requirement)
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://support.google.com/cloud/answer/13465431 (CASA assurance levels)
- https://support.google.com/cloud/answer/15549945 (100-user caps)
- https://support.google.com/cloud/answer/13804565 (demo video)
- https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- https://workspace.google.com/blog/ai-and-machine-learning/api-policy-protections
- https://www.appdefensealliance.org/certification/authorized-labs
- https://tacsecurity.com/?p=18721 ; https://leviathansecurity.com/programs/google-casa-cloud-application-security-assessment
- https://meetorbis.com/blog/how-we-passed-google-casa-tier-2-with-claude
- https://www.anthropic.com/legal/commercial-terms
- https://developers.googleblog.com/en/modernizing-oauth-interactions-in-native-apps-for-better-usability-and-security/
- https://scl-llp.com/ninth-circuit-upholds-apple-contempt-finding-but-narrows-scope-of-remedial-relief/
