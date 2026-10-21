// Link or unlink a hand-off channel for the signed-in user.
// Deploy with verify_jwt=true.
//
//   POST   { channel: "whatsapp" } → { code, wa_url, expires_at }   the app opens wa_url; the user taps Send
//   GET                            → { whatsapp: { display, linked_at } | null }
//   DELETE { channel: "whatsapp" } → { ok: true }
// Secret: WHATSAPP_NUMBER (E.164 digits of Nudged's business number, e.g. 14165551234).

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const NUDGED_NUMBER = (Deno.env.get("WHATSAPP_NUMBER") ?? "").replace(/\D/g, "");
const CODE_TTL_MIN = 15;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!data.user) return json({ error: "sign in first" }, 401);
  const userId = data.user.id;

  if (req.method === "GET") {
    const { data: link } = await admin.from("channel_links").select("display,linked_at").eq("user_id", userId).eq("channel", "whatsapp").maybeSingle();
    return json({ whatsapp: link ?? null });
  }

  const body = await req.json().catch(() => ({}));
  if (body.channel !== "whatsapp") return json({ error: "unknown channel" }, 400);

  if (req.method === "DELETE") {
    await admin.from("channel_links").delete().eq("user_id", userId).eq("channel", "whatsapp");
    await admin.from("link_codes").delete().eq("user_id", userId);
    return json({ ok: true });
  }

  if (req.method === "POST") {
    if (!NUDGED_NUMBER) return json({ error: "WhatsApp is not set up yet" }, 503);
    await admin.from("link_codes").delete().eq("user_id", userId);   // one live code per user
    const { data: gen } = await admin.rpc("gen_link_code");
    const code = String(gen);
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
    const { error } = await admin.from("link_codes").insert({ code, user_id: userId, channel: "whatsapp", expires_at: expires });
    if (error) return json({ error: "could not make a code, try again" }, 500);
    return json({ code, wa_url: `https://wa.me/${NUDGED_NUMBER}?text=${encodeURIComponent(code)}`, expires_at: expires });
  }

  return json({ error: "method not allowed" }, 405);
});
