// GET /license-check?key=ND-XXXX-XXXX-XXXX-XXXX
// Called by the plugin's run and setup skills. Read-only apart from a usage stamp.
// Deploy with verify_jwt=false: the caller is a Claude session with no Supabase user.
//
// Response: { valid, plan, renews, message, limits }
//   plan    free | monthly | yearly
//   limits  what the skill should apply for this plan; the plugin never hard-codes these.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const KEY_RE = /^ND-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const GRACE_DAYS = 3; // keep running a little past a failed renewal

type Limits = { open_notes: number | null; lookback_days: number; calendar_writes: boolean; drafts: boolean };
const LIMITS: Record<string, Limits> = {
  free:    { open_notes: 30,   lookback_days: 2, calendar_writes: false, drafts: false },
  monthly: { open_notes: null, lookback_days: 2, calendar_writes: true,  drafts: true },
  yearly:  { open_notes: null, lookback_days: 2, calendar_writes: true,  drafts: true },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ valid: false, message: "GET only" }, 405);
  const key = (new URL(req.url).searchParams.get("key") ?? "").trim().toUpperCase();
  if (!KEY_RE.test(key)) return json({ valid: false, message: "That does not look like a licence key." });

  const { data: lic, error } = await supabase
    .from("licenses")
    .select("plan,status,current_period_end,check_count")
    .eq("license_key", key)
    .maybeSingle();
  if (error) return json({ valid: false, message: "Licence service error, try again." }, 500);
  if (!lic) return json({ valid: false, message: "No licence with that key." });

  const periodEnd = lic.current_period_end ? new Date(lic.current_period_end) : null;
  const graceEnd = periodEnd ? new Date(periodEnd.getTime() + GRACE_DAYS * 86400_000) : null;
  const now = new Date();

  let valid = false;
  let message = "";
  let plan: string = lic.plan;
  if (lic.plan === "free") {
    // Free rows never expire; status is the only switch (set to cancelled to revoke).
    valid = lic.status === "active";
    message = valid ? "Free plan" : "This free key was turned off.";
  } else if (lic.status === "active") {
    valid = !graceEnd || now <= graceEnd;
    message = valid ? "Active" : "Your subscription period ended.";
  } else if (lic.status === "past_due") {
    valid = !!graceEnd && now <= graceEnd;
    message = valid ? "Payment failed, running on grace period." : "Payment failed and the grace period ended.";
  } else {
    // A cancelled subscriber keeps a working key on the free plan rather than a dead one.
    valid = true;
    plan = "free";
    message = "Subscription cancelled; running on the free plan. Resubscribe at nudged.pro to get Pro back.";
  }

  // Usage stamp; failure here never affects the answer.
  await supabase
    .from("licenses")
    .update({ last_checked_at: now.toISOString(), check_count: (lic.check_count ?? 0) + 1 })
    .eq("license_key", key);

  return json({
    valid,
    plan,
    renews: plan === "free" ? null : periodEnd ? periodEnd.toISOString().slice(0, 10) : null,
    message,
    limits: LIMITS[plan] ?? LIMITS.free,
  });
});
