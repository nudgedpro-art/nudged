// POST /ingest  { text, from_hint? }      — the app's share-sheet
// Deploy with verify_jwt=true (a signed-in app user).
// Returns { outcome, reply, note? }. Same pipeline as a WhatsApp forward.

import { createClient } from "npm:@supabase/supabase-js@2";
import { processInbound } from "../_shared/channels.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!data.user) return json({ error: "sign in first" }, 401);

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim().slice(0, 8000);
  const fromHint = body.from_hint ? String(body.from_hint).trim().slice(0, 120) : null;
  if (text.length < 3) return json({ error: "nothing to read" }, 400);

  const { data: row, error } = await admin.from("inbound_messages")
    .insert({ user_id: data.user.id, channel: "share", body: text, from_hint: fromHint }).select("id").single();
  if (error || !row) return json({ error: "could not record the message" }, 500);

  const r = await processInbound(admin, row.id as string);
  return json({ outcome: r.outcome, reply: r.reply, note: r.note ? { doc_id: r.note.doc_id, title: r.note.title, who: r.note.who, expected: r.note.expected, time: r.note.time, status: r.note.status, event_url: r.note.event_url } : null });
});
