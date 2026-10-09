// Stripe → licence store.
// Deploy with verify_jwt=false (Stripe signs the request; we verify that signature).
// Secrets: STRIPE_WEBHOOK_SECRET (live endpoint), STRIPE_WEBHOOK_SECRET_TEST (sandbox endpoint, optional),
//          RESEND_API_KEY, FROM_EMAIL (Edge Functions → Secrets).
// No Stripe API key: signature verification is local, and every field we need arrives inside the events.
//
// Subscribed events:
//   checkout.session.completed      → issue a key and email it
//   customer.subscription.created   → record period end + plan
//   customer.subscription.updated   → mirror status + period end
//   customer.subscription.deleted   → status cancelled
//   invoice.payment_failed          → status past_due

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe("sk_unused_signature_verification_only", { apiVersion: "2025-02-24.acacia" });
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WEBHOOK_SECRETS = [Deno.env.get("STRIPE_WEBHOOK_SECRET"), Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST")].filter((x): x is string => !!x);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Nudged <hello@nudged.pro>";

function planFor(sub: Stripe.Subscription): string {
  const interval = sub.items.data[0]?.price?.recurring?.interval;
  return interval === "year" ? "yearly" : "monthly";
}

// API 2025-03-31+ moved current_period_end from the subscription to its items.
function periodEndIso(sub: Stripe.Subscription): string | null {
  // deno-lint-ignore no-explicit-any
  const s = sub as any;
  const secs = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return typeof secs === "number" ? new Date(secs * 1000).toISOString() : null;
}

// API 2025-03-31+ moved invoice.subscription under invoice.parent.subscription_details.
function invoiceSubId(inv: Stripe.Invoice): string | null {
  // deno-lint-ignore no-explicit-any
  const i = inv as any;
  const ref = i.subscription ?? i.parent?.subscription_details?.subscription ?? null;
  return typeof ref === "string" ? ref : ref?.id ?? null;
}

async function sendKeyEmail(to: string, key: string) {
  const body = [
    `Thanks for subscribing to Nudged.`,
    ``,
    `Your licence key: ${key}`,
    ``,
    `To install, open the Claude desktop app, go to the Code tab, and run:`,
    `  /plugin marketplace add nudgedpro-art/nudged`,
    `  /plugin install nudged@nudged`,
    `  /nudged:setup`,
    ``,
    `Before you start, connect Gmail and Google Calendar in Claude (Settings, Connectors). Setup checks the key and those connections, publishes your private board, and creates the hourly routine, which runs while the desktop app is open.`,
    ``,
    `Manage or cancel any time from the link in your Stripe receipt.`,
  ].join("\n");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY missing; key not emailed");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject: "Your Nudged licence key", text: body }),
  });
  if (!r.ok) throw new Error(`resend failed ${r.status}: ${await r.text()}`);
}

// Find or create the licence row for a subscription. Safe under concurrent events:
// a duplicate insert (unique stripe_subscription_id) falls back to the existing row.
async function ensureLicense(subId: string, fields: Record<string, unknown>): Promise<{ license_key: string; email: string }> {
  const sel = () => supabase.from("licenses").select("license_key,email").eq("stripe_subscription_id", subId).maybeSingle();
  const { data: existing } = await sel();
  if (existing) return existing as { license_key: string; email: string };
  const { data: key, error: keyErr } = await supabase.rpc("gen_license_key");
  if (keyErr || !key) throw new Error(`key generation failed: ${keyErr?.message}`);
  const { error } = await supabase.from("licenses").insert({ license_key: key, stripe_subscription_id: subId, status: "active", email: "", ...fields });
  if (error) {
    if (error.code === "23505") { const { data: again } = await sel(); if (again) return again as { license_key: string; email: string }; }
    throw new Error(`licence insert failed: ${error.message}`);
  }
  return { license_key: key as string, email: (fields.email as string) ?? "" };
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode !== "subscription" || !s.subscription) return;
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      const email = s.customer_details?.email ?? s.customer_email ?? "";
      const lic = await ensureLicense(subId, { email, stripe_customer_id: String(s.customer) });
      if (email && lic.email !== email) {
        await supabase.from("licenses").update({ email, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", subId);
      }
      if (email) await sendKeyEmail(email, lic.license_key);
      return;
    }
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      const periodEnd = periodEndIso(sub);
      await ensureLicense(sub.id, { stripe_customer_id: String(sub.customer), plan: planFor(sub), current_period_end: periodEnd });
      await supabase.from("licenses").update({ plan: planFor(sub), current_period_end: periodEnd, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", sub.id);
      return;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const status = sub.status === "active" || sub.status === "trialing" ? "active"
        : sub.status === "past_due" || sub.status === "unpaid" ? "past_due" : "cancelled";
      await supabase.from("licenses").update({
        status, plan: planFor(sub),
        current_period_end: periodEndIso(sub),
        updated_at: new Date().toISOString(),
      }).eq("stripe_subscription_id", sub.id);
      return;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await supabase.from("licenses").update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", sub.id);
      return;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const subId = invoiceSubId(inv);
      if (subId) await supabase.from("licenses").update({ status: "past_due", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subId);
      return;
    }
  }
}

Deno.serve(async (req) => {
  if (WEBHOOK_SECRETS.length === 0) return new Response("webhook secret not configured", { status: 500 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });
  const raw = await req.text();
  // One function serves both the live and the sandbox endpoint; each has its own signing secret.
  let event: Stripe.Event | null = null;
  let sigErr = "";
  for (const secret of WEBHOOK_SECRETS) {
    try { event = await stripe.webhooks.constructEventAsync(raw, sig, secret); break; }
    catch (e) { sigErr = (e as Error).message; }
  }
  if (!event) return new Response(`bad signature: ${sigErr}`, { status: 400 });

  // Idempotency: an event is marked seen only after it was fully processed,
  // so a failed attempt is retried by Stripe instead of being swallowed.
  const { data: seen } = await supabase.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return new Response("already handled", { status: 200 });

  try {
    await handle(event);
  } catch (e) {
    console.error(event.type, (e as Error).message);
    return new Response(`processing failed: ${(e as Error).message}`, { status: 500 });
  }
  await supabase.from("stripe_events").insert({ id: event.id, type: event.type });
  return new Response("ok", { status: 200 });
});
