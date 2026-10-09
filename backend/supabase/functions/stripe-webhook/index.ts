// Stripe → licence store.
// Deploy with verify_jwt=false (Stripe signs the request; we verify that signature).
// Secrets: STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, FROM_EMAIL (Edge Functions → Secrets).
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
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Nudged <hello@nudged.pro>";

function planFor(sub: Stripe.Subscription): string {
  const interval = sub.items.data[0]?.price?.recurring?.interval;
  return interval === "year" ? "yearly" : "monthly";
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
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY missing; key not emailed", { to }); return; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject: "Your Nudged licence key", text: body }),
  });
  if (!r.ok) console.error("resend failed", r.status, await r.text());
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET) return new Response("webhook secret not configured", { status: 500 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error).message}`, { status: 400 });
  }

  // Idempotency: a replayed event is acknowledged and ignored.
  const { error: dupe } = await supabase.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupe) return new Response("already handled", { status: 200 });

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode !== "subscription" || !s.subscription) break;
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      const email = s.customer_details?.email ?? s.customer_email ?? "";
      // The subscription.created event (which usually arrives first) may already have made the row.
      const { data: existing } = await supabase.from("licenses").select("license_key,email").eq("stripe_subscription_id", subId).maybeSingle();
      let key = existing?.license_key as string | undefined;
      if (!key) {
        const { data: fresh } = await supabase.rpc("gen_license_key");
        key = fresh as string;
        const { error } = await supabase.from("licenses").insert({
          license_key: key, email, stripe_customer_id: String(s.customer), stripe_subscription_id: subId, status: "active",
        });
        if (error) { console.error(error); return new Response("db error", { status: 500 }); }
      } else if (email && !existing?.email) {
        await supabase.from("licenses").update({ email }).eq("stripe_subscription_id", subId);
      }
      if (email) await sendKeyEmail(email, key);
      break;
    }
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
      const { data: existing } = await supabase.from("licenses").select("id").eq("stripe_subscription_id", sub.id).maybeSingle();
      if (existing) {
        await supabase.from("licenses").update({ plan: planFor(sub), current_period_end: periodEnd, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", sub.id);
      } else {
        const { data: key } = await supabase.rpc("gen_license_key");
        await supabase.from("licenses").insert({
          license_key: key, email: "", stripe_customer_id: String(sub.customer), stripe_subscription_id: sub.id,
          plan: planFor(sub), status: "active", current_period_end: periodEnd,
        });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const status = sub.status === "active" || sub.status === "trialing" ? "active"
        : sub.status === "past_due" || sub.status === "unpaid" ? "past_due" : "cancelled";
      await supabase.from("licenses").update({
        status, plan: planFor(sub),
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("stripe_subscription_id", sub.id);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await supabase.from("licenses").update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", sub.id);
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
      if (subId) await supabase.from("licenses").update({ status: "past_due", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subId);
      break;
    }
  }
  return new Response("ok", { status: 200 });
});
