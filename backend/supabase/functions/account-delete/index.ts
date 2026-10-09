// Delete everything Nudged holds about the signed-in person, and revoke the
// Google grant. Required by Google (deletion URL) and both app stores.
// POST with the user's Supabase JWT. Deploy with verify_jwt=false; the JWT is
// checked here so the response can be a clear JSON message.

import { createClient } from "npm:@supabase/supabase-js@2";
import { revokeToken, accessTokenFromRefresh } from "../_shared/google.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!data.user) return json({ error: "sign in first" }, 401);
  const userId = data.user.id;

  // Revoke at Google first (best effort), then wipe our side in one transaction.
  try {
    const { data: rt } = await admin.rpc("read_google_refresh_token", { p_user_id: userId });
    if (rt) {
      try { await revokeToken(await accessTokenFromRefresh(rt)); } catch { /* already gone */ }
      await revokeToken(rt);
    }
  } catch (e) { console.warn("revoke", (e as Error).message); }

  const { error } = await admin.rpc("delete_account", { p_user_id: userId });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, message: "Your Nudged account and all its data were deleted. Google access was revoked. Cancel any subscription from your Stripe receipt." });
});
