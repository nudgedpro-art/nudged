// The Nudged routine, server-side. Runs every 15 minutes from pg_cron, or for
// one user right after they connect, or on demand from the app ("Sync now").
//
// Per user: mint an access token from the Vault refresh token, read new
// human-to-human mail from the last 3 days plus any thread attached to an
// open note, triage cheaply (Haiku), extract commitments and dated plans
// (Sonnet), keep one living note per item, write/patch Calendar events for
// confirmed ones, nudge on silence. Only extracted items are stored; message
// bodies are never written anywhere.
//
// Auth: header x-cron-secret == CRON_SECRET (cron / internal), or a user JWT
// (then only that user is synced). Deploy with verify_jwt=false.
// Secrets: CRON_SECRET, ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  RevokedError, accessTokenFromRefresh, gmailProfile, gmailSearch, gmailThreadMessageIds, gmailMessage,
  calendarInsert, calendarPatch, type ParsedMessage,
} from "../_shared/google.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TRIAGE_MODEL = Deno.env.get("TRIAGE_MODEL") ?? "claude-haiku-4-5-20251001";
const EXTRACT_MODEL = Deno.env.get("EXTRACT_MODEL") ?? "claude-sonnet-5-5";
const MARK = "— Nudged, kept up to date automatically.";
const MAX_USERS_PER_RUN = 25;
const MAX_MESSAGES_PER_USER = 60;

type Note = {
  id: string; user_id: string; doc_id: string; title: string; kind: "commitment" | "event";
  status: "pending" | "scheduled" | "done" | "dismissed" | "cancelled"; manual: boolean; needs_me: boolean;
  who: string; expected: string | null; expected_end: string | null; time: string | null; time_end: string | null;
  location: string | null; threads: string[]; msgs: number; event: string | null; event_url: string | null;
  source_url: string | null; subject: string | null; nudged: string | null; note: string;
  clips: { at: string; from: string; text: string; subject?: string }[]; updated_at: string; closed_at: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-cron-secret" } });
}

// ------------------------------------------------------------- Anthropic
async function claude(model: string, system: string, user: string, maxTokens = 4000): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return (j.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
}
function parseJson<T>(s: string): T {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m ? m[1] : s).trim();
  const start = body.search(/[\[{]/);
  return JSON.parse(body.slice(start)) as T;
}

const TRIAGE_SYSTEM = `You triage email for a follow-up assistant. For each message decide KEEP or SKIP.
KEEP only human-to-human mail that contains a real commitment (someone promises to do, send, deliver, pay, confirm, call, or decide something, with or without a date) or a real dated plan (an appointment, visit, trip, dinner, meeting, delivery or pickup on a stated day).
SKIP newsletters, receipts, order confirmations, calendar invitations, developer-tool alerts, marketing, no-reply senders, mailing lists, mass forwards, social notifications, and anything with no concrete follow-up. EXCEPTION: keep a shipping, delivery, pickup or return notice that names a specific date for the recipient's own address.
When unsure, SKIP. Answer with JSON only: {"keep":["<id>",...]}`;

const EXTRACT_SYSTEM = `You maintain a board of living notes for one person: one note per commitment or dated plan found in their email. You receive their open notes and new messages. Return JSON only.

Rules
- Resolve relative dates against each message's own send date in the user's timezone ("Friday" written on a Tuesday is that coming Friday). Dates are YYYY-MM-DD, times HH:MM 24h local.
- Match a message to an existing note first by thread id, then by same other party plus same date, then by clearly the same topic. Create a new note only when nothing matches.
- kind "commitment": an open loop someone owes someone. status "pending" until a firm date/time exists, then "scheduled".
- kind "event": a dated plan. "scheduled" immediately when it has a date.
- needs_me: true when the next move belongs to the user (a reply they owe, something they promised).
- who: "Name, organisation" of the other party, never an email address.
- Cancellation or postponement: status "cancelled" (or "pending" if a new date is expected), never delete.
- A reply from the user that resolves what they owed: needs_me false. A reply from the other party that closes the loop with nothing further expected: status "done".
- If a plan or deadline has a known date that already passed, keep that date in expected (never blank it); set status "pending" and needs_me true so the person checks what happened.
- Titles are short and neutral (no dates). Keep medical, insurance and financial detail out of titles.
- clips are 1–3 sentence paraphrases of what a message added, never pasted text.
- note is one or two plain sentences on where things stand right now.
- Be conservative: zero actions is a fine answer.

Output shape
{"actions":[
 {"op":"create","doc_id":"<kebab-slug>","title":"","kind":"commitment|event","status":"pending|scheduled","needs_me":false,"who":"","expected":null,"expected_end":null,"time":null,"time_end":null,"location":null,"threads":["<threadId>"],"subject":"","note":"","clip":{"at":"YYYY-MM-DD","from":"","text":""}},
 {"op":"update","doc_id":"<existing>","patch":{"status":"...","needs_me":true,"expected":"...","time":"...","who":"...","note":"...","location":"...","expected_end":null,"time_end":null},"add_thread":"<threadId or null>","clip":{"at":"YYYY-MM-DD","from":"","text":""}}
]}
Only include patch keys that change. Every action must carry a clip.`;

// --------------------------------------------------------------- helpers
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number); return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
}
function describe(n: Note): string {
  const lines = [n.note, ""];
  if (n.who) lines.push(`Who: ${n.who}`);
  if (n.expected) lines.push(`When: ${n.expected}${n.expected_end ? " to " + n.expected_end : ""}${n.time ? " " + n.time : ""}${n.time_end ? "–" + n.time_end : ""}`);
  if (n.location) lines.push(`Where: ${n.location}`);
  const recent = n.clips.slice(-5);
  if (recent.length) { lines.push("", "Latest:"); for (const c of recent) lines.push(`• ${c.at} ${c.from}: ${c.text}`); }
  lines.push("", `${MARK} Source: ${n.subject ?? ""}`);
  return lines.join("\n").slice(0, 1500);
}
function eventTimes(n: Note, tz: string) {
  if (!n.expected) return null;
  if (n.time) {
    const end = n.time_end ?? addHour(n.time);
    const endDate = n.time_end && n.time_end < n.time ? addDays(n.expected, 1) : (n.expected_end ?? n.expected);
    return { allDay: false, start: `${n.expected}T${n.time}:00`, end: `${endDate}T${end}:00`, timeZone: tz };
  }
  return { allDay: true, start: n.expected, end: addDays(n.expected_end ?? n.expected, 1), timeZone: tz };
}

// ---------------------------------------------------------- per-user sync
async function syncUser(userId: string): Promise<{ messages: number; created: number; updated: number; nudges: number }> {
  const stats = { messages: 0, created: 0, updated: 0, nudges: 0 };
  const { data: conn } = await admin.from("google_connections").select("user_id,email,status,history_id").eq("user_id", userId).maybeSingle();
  if (!conn || conn.status !== "active") return stats;
  const { data: prof } = await admin.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const tz = prof?.timezone ?? "America/Toronto";
  const today = todayIn(tz);

  const { data: rt } = await admin.rpc("read_google_refresh_token", { p_user_id: userId });
  if (!rt) throw new RevokedError("no refresh token on file");
  const token = await accessTokenFromRefresh(rt as string);

  // 1. Open notes
  const { data: notesRaw } = await admin.from("notes").select("*").eq("user_id", userId);
  const notes = (notesRaw ?? []) as Note[];
  const open = notes.filter((n) => n.status === "pending" || n.status === "scheduled");
  const byDoc = new Map(notes.map((n) => [n.doc_id, n]));

  // 2. Candidate messages: recent search + threads of open notes
  const q = `newer_than:3d -category:promotions -category:social -category:forums`;
  const found = new Map<string, string>();  // messageId → threadId
  for (const m of await gmailSearch(token, q, MAX_MESSAGES_PER_USER)) found.set(m.id, m.threadId);
  const openThreads = new Set(open.flatMap((n) => n.threads));
  for (const t of [...openThreads].slice(0, 40)) {
    try { for (const m of await gmailThreadMessageIds(token, t)) found.set(m.id, m.threadId); } catch { /* thread gone */ }
  }
  const ids = [...found.keys()];
  const { data: done } = ids.length ? await admin.from("processed_messages").select("message_id").eq("user_id", userId).in("message_id", ids) : { data: [] };
  const seen = new Set((done ?? []).map((d: { message_id: string }) => d.message_id));
  const fresh = ids.filter((id) => !seen.has(id)).slice(0, MAX_MESSAGES_PER_USER);
  stats.messages = fresh.length;

  // 3. Fetch + heuristic skip + triage
  const msgs: ParsedMessage[] = [];
  for (const id of fresh) { try { msgs.push(await gmailMessage(token, id)); } catch (e) { console.warn("message", id, (e as Error).message); } }
  const inOpenThread = (m: ParsedMessage) => openThreads.has(m.threadId);
  const candidates = msgs.filter((m) => m.text.length > 20 && (inOpenThread(m) || (!m.listUnsubscribe && (!m.automated || /deliver|shipment|shipping|pickup|pick-up|return|arriv/i.test(m.subject + " " + m.text.slice(0, 300))))));
  let kept: ParsedMessage[] = candidates.filter(inOpenThread);
  const toTriage = candidates.filter((m) => !inOpenThread(m));
  if (toTriage.length) {
    const user = JSON.stringify(toTriage.map((m) => ({ id: m.id, from: m.from, to: m.to, subject: m.subject, date: m.isoDate, text: m.text.slice(0, 1200) })));
    try {
      const out = parseJson<{ keep: string[] }>(await claude(TRIAGE_MODEL, TRIAGE_SYSTEM, user, 1000));
      const keepSet = new Set(out.keep ?? []);
      kept = kept.concat(toTriage.filter((m) => keepSet.has(m.id)));
    } catch (e) { console.warn("triage", (e as Error).message); }
  }

  // 4. Extract
  const changed = new Map<string, Note>();
  if (kept.length) {
    const openCompact = open.map((n) => ({ doc_id: n.doc_id, title: n.title, kind: n.kind, status: n.status, needs_me: n.needs_me, who: n.who, expected: n.expected, time: n.time, threads: n.threads, note: n.note }));
    const user = JSON.stringify({
      user_email: conn.email, timezone: tz, today,
      open_notes: openCompact,
      messages: kept.map((m) => ({ id: m.id, threadId: m.threadId, from: m.from, to: m.to, subject: m.subject, date: m.isoDate, from_user: m.from.toLowerCase().includes(conn.email.toLowerCase()), text: m.text.slice(0, 2500) })),
    });
    // deno-lint-ignore no-explicit-any
    let actions: any[] = [];
    try { actions = parseJson<{ actions: unknown[] }>(await claude(EXTRACT_MODEL, EXTRACT_SYSTEM, user, 6000)).actions ?? []; }
    catch (e) { console.warn("extract", (e as Error).message); }

    const now = new Date().toISOString();
    for (const a of actions) {
      try {
        if (a.op === "create") {
          let docId = slug(a.doc_id || a.title); let i = 2;
          while (byDoc.has(docId)) docId = `${slug(a.doc_id || a.title)}-${i++}`;
          const msg = kept.find((m) => (a.threads ?? []).includes(m.threadId));
          const n: Note = {
            id: crypto.randomUUID(), user_id: userId, doc_id: docId, title: String(a.title ?? "Untitled").slice(0, 120),
            kind: a.kind === "event" ? "event" : "commitment",
            status: a.status === "scheduled" && a.expected ? "scheduled" : "pending",
            manual: false, needs_me: !!a.needs_me, who: String(a.who ?? ""), expected: a.expected ?? null, expected_end: a.expected_end ?? null,
            time: a.time ?? null, time_end: a.time_end ?? null, location: a.location ?? null,
            threads: (a.threads ?? []).filter((t: string) => typeof t === "string"), msgs: 0, event: null, event_url: null,
            source_url: msg ? `https://mail.google.com/mail/#all/${msg.threadId}` : null, subject: a.subject ?? msg?.subject ?? null,
            nudged: null, note: String(a.note ?? ""), clips: a.clip ? [a.clip] : [], updated_at: now, closed_at: null,
          };
          n.msgs = msgs.filter((m) => n.threads.includes(m.threadId)).length;
          byDoc.set(docId, n); changed.set(docId, n); stats.created++;
        } else if (a.op === "update" && byDoc.has(a.doc_id)) {
          const n = byDoc.get(a.doc_id)!;
          if (n.status === "done" || n.status === "dismissed") continue;
          const p = a.patch ?? {};
          for (const k of ["status", "needs_me", "expected", "expected_end", "time", "time_end", "who", "note", "location", "title"] as const) {
            // deno-lint-ignore no-explicit-any
            if (k in p) (n as any)[k] = p[k];
          }
          if (a.add_thread && !n.threads.includes(a.add_thread)) n.threads.push(a.add_thread);
          if (a.clip) n.clips.push(a.clip);
          n.msgs += msgs.filter((m) => n.threads.includes(m.threadId)).length;
          if (n.status === "pending" && n.kind === "event" && n.expected) n.status = "scheduled";
          if ((n.status === "done" || n.status === "cancelled") && !n.closed_at) n.closed_at = now;
          n.updated_at = now;
          changed.set(n.doc_id, n); stats.updated++;
        }
      } catch (e) { console.warn("action", (e as Error).message); }
    }
  }

  // 5. Nudges on silence
  for (const n of open) {
    if (n.status !== "pending") continue;
    const last = n.clips.length ? n.clips[n.clips.length - 1].at : n.updated_at.slice(0, 10);
    const overdue = n.expected ? n.expected < addDays(today, -1) : false;
    const quiet = last < addDays(today, -5);
    const recentlyNudged = n.nudged ? n.nudged >= addDays(today, -3) : false;
    if ((overdue || quiet) && !recentlyNudged) {
      n.clips.push({ at: today, from: "Nudged", text: `Nudge: no follow-up since ${last}. Chase ${n.who || "them"}?` });
      n.needs_me = true; n.nudged = today; n.updated_at = new Date().toISOString();
      changed.set(n.doc_id, n); stats.nudges++;
    }
  }

  // 6. Calendar
  for (const n of changed.values()) {
    try {
      const times = eventTimes(n, tz);
      if (n.event) {
        const summary = (n.status === "cancelled" ? "❌ " : "📌 ") + n.title;
        await calendarPatch(token, n.event, { summary, description: describe(n), location: n.location, ...(times ?? {}) });
      } else if (n.status === "scheduled" && times) {
        const ev = await calendarInsert(token, { summary: "📌 " + n.title, description: describe(n), location: n.location, ...times });
        n.event = ev.id; n.event_url = ev.htmlLink;
      }
    } catch (e) { console.warn("calendar", n.doc_id, (e as Error).message); }
  }

  // 7. Write notes, then mark messages processed
  for (const n of changed.values()) {
    const { error } = await admin.from("notes").upsert(n, { onConflict: "user_id,doc_id" });
    if (error) console.warn("note upsert", n.doc_id, error.message);
  }
  if (fresh.length) {
    await admin.from("processed_messages").upsert(fresh.map((id) => ({ user_id: userId, message_id: id, thread_id: found.get(id) })), { onConflict: "user_id,message_id", ignoreDuplicates: true });
  }
  let historyId: string | null = null;
  try { historyId = (await gmailProfile(token)).historyId; } catch { /* optional */ }
  await admin.from("google_connections").update({ last_sync_at: new Date().toISOString(), last_error: null, ...(historyId ? { history_id: historyId } : {}), updated_at: new Date().toISOString() }).eq("user_id", userId);
  return stats;
}

async function runFor(userId: string) {
  const { data: run } = await admin.from("sync_runs").insert({ user_id: userId }).select("id").single();
  try {
    const s = await syncUser(userId);
    await admin.from("sync_runs").update({ finished_at: new Date().toISOString(), ...s }).eq("id", run!.id);
    return { user_id: userId, ...s };
  } catch (e) {
    const msg = (e as Error).message;
    await admin.from("sync_runs").update({ finished_at: new Date().toISOString(), error: msg }).eq("id", run!.id);
    await admin.from("google_connections").update({
      last_error: msg, updated_at: new Date().toISOString(), ...(e instanceof RevokedError ? { status: "revoked" } : {}),
    }).eq("user_id", userId);
    return { user_id: userId, error: msg };
  }
}

async function licensed(userId: string): Promise<boolean> {
  const { data } = await admin.from("licenses").select("status,current_period_end").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return false;
  const grace = data.current_period_end ? new Date(data.current_period_end).getTime() + 3 * 86400_000 : Infinity;
  return (data.status === "active" || data.status === "past_due") && Date.now() <= grace;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;

  let userIds: string[] = [];
  if (isCron) {
    if (body.user_id) userIds = [body.user_id];
    else {
      const { data } = await admin.from("google_connections").select("user_id").eq("status", "active")
        .order("last_sync_at", { ascending: true, nullsFirst: true }).limit(MAX_USERS_PER_RUN);
      userIds = (data ?? []).map((r: { user_id: string }) => r.user_id);
    }
  } else {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    if (!data.user) return json({ error: "sign in first" }, 401);
    userIds = [data.user.id];
  }

  const results = [];
  for (const id of userIds) {
    if (!(await licensed(id))) { results.push({ user_id: id, skipped: "licence inactive" }); continue; }
    results.push(await runFor(id));
  }
  return json({ ok: true, results });
});
