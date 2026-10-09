// Google sign-in + Gmail/Calendar connection for the Nudged app.
// Deploy with verify_jwt=false: /start and /callback are reached by a browser
// with no Supabase session yet. /disconnect checks the user's JWT itself.
//
//   GET  /google-auth/start?ret=web|app       → redirect to Google consent
//   GET  /google-auth/callback?code&state     → exchange, store refresh token in Vault,
//                                               create/link the Supabase user, start the
//                                               trial licence, redirect with a magic-link token
//   POST /google-auth/disconnect  (Bearer user JWT) → revoke at Google, delete the token
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, APP_URL, CRON_SECRET (HMAC key for state).

import { createClient } from "npm:@supabase/supabase-js@2";
import { SCOPES, exchangeCode, decodeIdToken, revokeToken, accessTokenFromRefresh } from "../_shared/google.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI") ?? `${SUPABASE_URL}/functions/v1/google-auth/callback`;
const APP_URL = Deno.env.get("APP_URL") ?? "https://nudged.pro/app/";
const APP_SCHEME = Deno.env.get("APP_SCHEME") ?? "nudged://auth";
const STATE_KEY = Deno.env.get("CRON_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const enc = new TextEncoder();
async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(STATE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function makeState(ret: string): Promise<string> {
  const body = btoa(JSON.stringify({ n: crypto.randomUUID(), t: Date.now(), ret })).replace(/=+$/, "");
  return `${body}.${await hmac(body)}`;
}
async function readState(state: string): Promise<{ ret: string } | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig || sig !== await hmac(body)) return null;
  const j = JSON.parse(atob(body));
  if (Date.now() - j.t > 15 * 60_000) return null;
  return { ret: j.ret === "app" ? "app" : "web" };
}

function html(body: string, status = 200) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nudged</title><body style="font:17px/1.5 system-ui;padding:32px;max-width:40em;margin:auto">${body}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" } });
}

async function userFromJwt(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  return data.user ?? null;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/google-auth/, "") || "/";
  if (req.method === "OPTIONS") return json({}, 200);

  if (req.method === "GET" && path === "/start") {
    if (!CLIENT_ID || !STATE_KEY) return html("<p>Google sign-in is not configured.</p>", 500);
    const ret = url.searchParams.get("ret") === "app" ? "app" : "web";
    const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    g.searchParams.set("client_id", CLIENT_ID);
    g.searchParams.set("redirect_uri", REDIRECT_URI);
    g.searchParams.set("response_type", "code");
    g.searchParams.set("scope", SCOPES.join(" "));
    g.searchParams.set("access_type", "offline");
    g.searchParams.set("prompt", "consent");
    g.searchParams.set("include_granted_scopes", "true");
    g.searchParams.set("state", await makeState(ret));
    return Response.redirect(g.toString(), 302);
  }

  if (req.method === "GET" && path === "/callback") {
    const err = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = await readState(url.searchParams.get("state") ?? "");
    if (!state) return html("<p>That sign-in link expired. <a href='start'>Try again</a>.</p>", 400);
    if (err || !code) return html(`<p>Google sign-in was cancelled (${err ?? "no code"}). <a href='${APP_URL}'>Back to Nudged</a>.</p>`, 400);

    try {
      const tok = await exchangeCode(code, REDIRECT_URI);
      if (!tok.id_token) throw new Error("no id_token in token response");
      const who = decodeIdToken(tok.id_token);
      const email = (who.email ?? "").toLowerCase();
      if (!email) throw new Error("Google returned no email");
      const granted = tok.scope.split(" ");
      const missing = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events"].filter((s) => !granted.includes(s));
      if (missing.length) {
        if (tok.refresh_token) await revokeToken(tok.refresh_token);
        return html(`<p>Nudged needs both the Gmail (read-only) and Calendar permissions to work. You left out: ${missing.map((m) => m.split("/").pop()).join(", ")}.</p><p><a href='start?ret=${state.ret}'>Try again and tick both boxes</a>.</p>`, 400);
      }

      // Supabase user: find by email or create (email confirmed, since Google verified it).
      let userId = await findUserIdByEmail(email);
      if (!userId) {
        const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { google_sub: who.sub } });
        if (error) throw new Error(`createUser: ${error.message}`);
        userId = data.user.id;
      }

      // Connection row (upsert), then the refresh token into Vault.
      const { error: cErr } = await admin.from("google_connections").upsert({
        user_id: userId, google_sub: who.sub, email, scopes: granted, status: "active", last_error: null, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (cErr) throw new Error(`connection upsert: ${cErr.message}`);
      if (tok.refresh_token) {
        const { error: vErr } = await admin.rpc("store_google_refresh_token", { p_user_id: userId, p_token: tok.refresh_token });
        if (vErr) throw new Error(`vault: ${vErr.message}`);
      } else {
        // prompt=consent should always return one; if not, the existing token stays in place.
        const { data: existing } = await admin.from("google_connections").select("refresh_secret_id").eq("user_id", userId).maybeSingle();
        if (!existing?.refresh_secret_id) throw new Error("Google did not return a refresh token; please try again");
      }

      // Licence: link a paid one or start the 14-day trial.
      await admin.rpc("ensure_license_for_user", { p_user_id: userId, p_email: email });

      // First sync in the background (the cron will catch it anyway).
      fetch(`${SUPABASE_URL}/functions/v1/nudged-sync`, {
        method: "POST", headers: { "content-type": "application/json", "x-cron-secret": STATE_KEY },
        body: JSON.stringify({ user_id: userId }),
      }).catch(() => {});

      // Session hand-off: a one-time magic-link token the client exchanges for a session.
      const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (lErr) throw new Error(`generateLink: ${lErr.message}`);
      const tokenHash = link.properties.hashed_token;
      const dest = state.ret === "app"
        ? `${APP_SCHEME}#token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`
        : `${APP_URL}#token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`;
      return Response.redirect(dest, 302);
    } catch (e) {
      console.error("callback", (e as Error).message);
      return html(`<p>Something went wrong connecting Google: ${(e as Error).message}</p><p><a href='start?ret=${state.ret}'>Try again</a> or email hello@nudged.pro.</p>`, 500);
    }
  }

  if (req.method === "POST" && path === "/disconnect") {
    const user = await userFromJwt(req);
    if (!user) return json({ error: "sign in first" }, 401);
    try {
      const { data: rt } = await admin.rpc("read_google_refresh_token", { p_user_id: user.id });
      if (rt) {
        try { await revokeToken(await accessTokenFromRefresh(rt)); } catch { /* already revoked */ }
        await revokeToken(rt);
      }
    } finally {
      await admin.rpc("delete_google_refresh_token", { p_user_id: user.id });
      await admin.from("google_connections").update({ status: "revoked", updated_at: new Date().toISOString() }).eq("user_id", user.id);
    }
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
});
