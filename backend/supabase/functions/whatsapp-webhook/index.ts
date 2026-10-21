// Meta WhatsApp Business Platform (Cloud API) webhook.
// Deploy with verify_jwt=false; Meta signs every POST and we verify that signature.
//
// Secrets: WHATSAPP_VERIFY_TOKEN   (any string; pasted into the Meta webhook config)
//          WHATSAPP_APP_SECRET     (Meta app → App settings → Basic)
//          WHATSAPP_ACCESS_TOKEN   (system-user token with whatsapp_business_messaging)
//          WHATSAPP_PHONE_NUMBER_ID
//          plus ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID/SECRET as nudged-sync.
//
// Flow per inbound text message:
//   link code (NUDGED-XXXX)  → bind wa_id to the user, reply "Linked"
//   unknown number           → reply with link instructions (once a day per number)
//   "who is that from" reply → attach from_hint to the previous needs_from row and re-run
//   anything else            → insert inbound_messages, processInbound, reply with the outcome
// Meta retries on non-2xx, so every message id is recorded first (unique) and the
// handler returns 200 even when extraction fails; the sweep retries once.

import { createClient } from "npm:@supabase/supabase-js@2";
import { processInbound, replyFor } from "../_shared/channels.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";
const CODE_RE = /^\s*NUDGED-([A-Z2-9]{4})\s*$/i;

async function verifySignature(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7).toLowerCase();
  if (hex.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function send(to: string, body: string) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) { console.warn("whatsapp send skipped: not configured"); return; }
  const r = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } }),
  });
  if (!r.ok) console.warn("whatsapp send", r.status, (await r.text()).slice(0, 300));
}

function mask(waId: string): string {
  const d = waId.replace(/\D/g, "");
  return d.length > 4 ? `+${d.slice(0, d.length - 7)} ••• ${d.slice(-4)}` : `+${d}`;
}

// deno-lint-ignore no-explicit-any
async function handleMessage(m: any, contactName: string) {
  const from: string = String(m.from ?? "");
  const id: string = String(m.id ?? "");
  if (!from || !id) return;
  const text: string = m.type === "text" ? String(m.text?.body ?? "") : "";

  // 1. Record first; a duplicate delivery stops here.
  const { error: insErr } = await admin.from("inbound_messages").insert({ channel: "whatsapp", external_id: id, body: text, user_id: null });
  if (insErr) { if (insErr.code !== "23505") console.warn("inbound insert", insErr.message); return; }
  const { data: row } = await admin.from("inbound_messages").select("id").eq("channel", "whatsapp").eq("external_id", id).single();
  const inboundId = row!.id as string;

  // 2. Link code?
  const code = text.match(CODE_RE);
  if (code) {
    const { data: lc } = await admin.from("link_codes").select("user_id,expires_at,used_at").eq("code", `NUDGED-${code[1].toUpperCase()}`).maybeSingle();
    if (!lc || lc.used_at || new Date(lc.expires_at).getTime() < Date.now()) {
      await admin.from("inbound_messages").update({ outcome: "error", body: null, processed_at: new Date().toISOString() }).eq("id", inboundId);
      await send(from, "That code has expired. Open the Nudged app, Settings, Connect WhatsApp, and try again.");
      return;
    }
    await admin.from("channel_links").delete().eq("user_id", lc.user_id).eq("channel", "whatsapp");   // re-link replaces
    await admin.from("channel_links").delete().eq("channel", "whatsapp").eq("external_id", from);      // number moves between accounts
    await admin.from("channel_links").insert({ user_id: lc.user_id, channel: "whatsapp", external_id: from, display: mask(from) });
    await admin.from("link_codes").update({ used_at: new Date().toISOString() }).eq("code", `NUDGED-${code[1].toUpperCase()}`);
    await admin.from("inbound_messages").update({ user_id: lc.user_id, outcome: "added", body: null, processed_at: new Date().toISOString() }).eq("id", inboundId);
    await send(from, "Linked. Forward me any message with a promise or a date and I'll put it on your board.");
    return;
  }

  // 3. Whose number is this?
  const { data: link } = await admin.from("channel_links").select("user_id").eq("channel", "whatsapp").eq("external_id", from).maybeSingle();
  if (!link) {
    await admin.from("inbound_messages").update({ outcome: "unlinked", body: null, processed_at: new Date().toISOString() }).eq("id", inboundId);
    // Reply at most once a day per unknown number.
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await admin.from("inbound_messages").select("id", { count: "exact", head: true })
      .eq("channel", "whatsapp").eq("outcome", "unlinked").is("user_id", null).gte("received_at", dayAgo).neq("id", inboundId);
    // We don't store the number on unlinked rows, so this is a global daily cap rather than per-number: good enough, and privacy-safe.
    if ((count ?? 0) < 50) await send(from, replyFor({ outcome: "unlinked", reply: "" }));
    return;
  }
  await admin.from("inbound_messages").update({ user_id: link.user_id }).eq("id", inboundId);

  // 4. Non-text (image, audio, document): phase 2. Say so.
  if (!text) {
    await admin.from("inbound_messages").update({ outcome: "nothing_found", body: null, processed_at: new Date().toISOString() }).eq("id", inboundId);
    await send(from, "I can only read text for now. Forward the message as text, or type the gist.");
    return;
  }

  // 5. Answer to "who is that from?" → attach to the waiting row and re-run it.
  const { data: waiting } = await admin.from("inbound_messages").select("id")
    .eq("user_id", link.user_id).eq("channel", "whatsapp").eq("outcome", "needs_from").is("processed_at", null)
    .gte("received_at", new Date(Date.now() - 86400_000).toISOString())
    .order("received_at", { ascending: false }).limit(1).maybeSingle();
  if (waiting && text.length <= 80 && !/\d{4}-\d{2}-\d{2}|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(text)) {
    await admin.from("inbound_messages").update({ from_hint: text.trim() }).eq("id", waiting.id);
    await admin.from("inbound_messages").update({ outcome: "added", body: null, processed_at: new Date().toISOString() }).eq("id", inboundId);
    const r = await processInbound(admin, waiting.id);
    await send(from, r.reply);
    return;
  }

  // 6. A forwarded message. Use the WhatsApp profile name only as a weak hint when the user forwarded nothing about the sender.
  void contactName;
  const r = await processInbound(admin, inboundId);
  await send(from, r.reply);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    // Meta's one-time verification handshake.
    if (url.searchParams.get("hub.mode") === "subscribe" && VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256")))) return new Response("bad signature", { status: 401 });

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (payload.object !== "whatsapp_business_account") return new Response("ignored", { status: 200 });

  // Always answer Meta quickly; the work is awaited but small (one message, one Claude call).
  const work: Promise<void>[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      const name = v.contacts?.[0]?.profile?.name ?? "";
      for (const m of v.messages ?? []) work.push(handleMessage(m, name).catch((e) => console.error("handleMessage", (e as Error).message)));
    }
  }
  await Promise.all(work);
  return new Response("ok", { status: 200 });
});
