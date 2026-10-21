// POST /free-signup  { "email": "..." }
// Issues a free-plan licence key and emails it. No Stripe involved.
// Deploy with verify_jwt=false: called from the nudged.pro landing page.
//
// Rules:
//   - one free key per email (unique index on lower(email) where plan='free');
//     a repeat request re-sends the existing key instead of minting another.
//   - an email that already has a paid row gets told so, no new key.
//   - 5 requests per IP per hour, 3 per email per day.
// Secrets: RESEND_API_KEY, FROM_EMAIL (same as stripe-webhook), SITE_ORIGIN (CORS; default https://nudged.pro).

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Nudged <hello@nudged.pro>";
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "https://nudged.pro";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CORS = {
  "access-control-allow-origin": SITE_ORIGIN,
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendKeyEmail(to: string, key: string, existing: boolean) {
  const body = [
    existing ? `Here is your Nudged free-plan key again.` : `Welcome to Nudged.`,
    ``,
    `Your licence key: ${key}`,
    ``,
    `The free plan watches one Gmail account, keeps up to 30 open notes on your board, and nudges you when something goes quiet. Pro adds calendar events, drafted follow-ups, forwarding from WhatsApp and texts, and no limits: ${SITE_ORIGIN}/#pro`,
    ``,
    `To install, open the Claude desktop app, go to the Code tab, and run:`,
    `  /plugin marketplace add nudgedpro-art/nudged`,
    `  /plugin install nudged@nudged`,
    `  /nudged:setup`,
    ``,
    `Before you start, connect Gmail and Google Calendar in Claude (Settings, Connectors). Setup checks the key and those connections, publishes your private board, and creates the hourly routine, which runs while the desktop app is open.`,
    ``,
    `If you upgrade later, this same key becomes your Pro key. Nothing to reinstall.`,
  ].join("\n");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY missing; key not emailed");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject: "Your Nudged licence key", text: body }),
  });
  if (!r.ok) throw new Error(`resend failed ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);

  let email = "";
  try { email = String((await req.json()).email ?? "").trim().toLowerCase(); } catch { /* fall through */ }
  if (!EMAIL_RE.test(email)) return json({ ok: false, message: "Enter a valid email address." }, 400);

  // Rate limits. The IP is hashed; we never store it.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = await sha256(ip);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const [{ count: byIp }, { count: byEmail }] = await Promise.all([
    supabase.from("signup_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hourAgo),
    supabase.from("signup_attempts").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", dayAgo),
  ]);
  if ((byIp ?? 0) >= 5 || (byEmail ?? 0) >= 3) return json({ ok: false, message: "Too many requests. Try again later." }, 429);
  await supabase.from("signup_attempts").insert({ ip_hash: ipHash, email });
  // Opportunistic prune so the table never grows.
  await supabase.from("signup_attempts").delete().lt("created_at", dayAgo);

  // Existing rows for this email, any plan.
  const { data: rows, error: selErr } = await supabase
    .from("licenses").select("license_key,plan,status").ilike("email", email);
  if (selErr) return json({ ok: false, message: "Licence service error, try again." }, 500);

  const paid = rows?.find((r) => r.plan !== "free" && r.status !== "cancelled");
  if (paid) return json({ ok: true, message: "That email already has a Nudged subscription. Your key is in your original email; write to hello@nudged.pro if you lost it." });

  const free = rows?.find((r) => r.plan === "free");
  if (free) {
    await sendKeyEmail(email, free.license_key, true);
    return json({ ok: true, message: "You already had a free key. We sent it again." });
  }

  const { data: key, error: keyErr } = await supabase.rpc("gen_license_key");
  if (keyErr || !key) return json({ ok: false, message: "Could not issue a key, try again." }, 500);
  const { error: insErr } = await supabase.from("licenses").insert({
    license_key: key, email, plan: "free", status: "active", current_period_end: null,
  });
  if (insErr) {
    // Lost a race with a duplicate request: re-send the one that won.
    if (insErr.code === "23505") {
      const { data: again } = await supabase.from("licenses").select("license_key").ilike("email", email).eq("plan", "free").maybeSingle();
      if (again) { await sendKeyEmail(email, again.license_key, true); return json({ ok: true, message: "Key sent." }); }
    }
    return json({ ok: false, message: "Could not issue a key, try again." }, 500);
  }

  try { await sendKeyEmail(email, key as string, false); }
  catch (e) { console.error("free-signup email", (e as Error).message); return json({ ok: false, message: "Key issued but the email failed. Write to hello@nudged.pro." }, 502); }
  return json({ ok: true, message: "Check your inbox for the key." });
});
