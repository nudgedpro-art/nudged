// Which plan a user is on and what it allows. Mirrors license-check's LIMITS
// so the app and the plugin agree.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Limits = { open_notes: number | null; lookback_days: number; calendar_writes: boolean; drafts: boolean; forward: boolean };
export type PlanInfo = { valid: boolean; plan: "free" | "trial" | "monthly" | "yearly"; effective: "free" | "pro"; limits: Limits };

const FREE: Limits = { open_notes: 30, lookback_days: 2, calendar_writes: false, drafts: false, forward: false };
const PRO: Limits  = { open_notes: null, lookback_days: 2, calendar_writes: true, drafts: true, forward: true };
const GRACE_DAYS = 3;

export async function planFor(admin: SupabaseClient, userId: string): Promise<PlanInfo> {
  const { data } = await admin.from("licenses").select("plan,status,current_period_end,trial_ends_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { valid: false, plan: "free", effective: "free", limits: FREE };
  const now = Date.now();
  const end = data.current_period_end ? new Date(data.current_period_end).getTime() : null;
  const plan = (data.plan ?? "free") as PlanInfo["plan"];

  if (plan === "free") return { valid: data.status === "active", plan, effective: "free", limits: FREE };
  if (plan === "trial") {
    const trialEnd = data.trial_ends_at ? new Date(data.trial_ends_at).getTime() : end;
    const live = data.status === "active" && trialEnd != null && now <= trialEnd;
    return { valid: true, plan, effective: live ? "pro" : "free", limits: live ? PRO : FREE };
  }
  const grace = end != null ? end + GRACE_DAYS * 86400_000 : Infinity;
  const live = (data.status === "active" || data.status === "past_due") && now <= grace;
  // A lapsed or cancelled subscriber keeps a working account on the free plan.
  return { valid: true, plan, effective: live ? "pro" : "free", limits: live ? PRO : FREE };
}
