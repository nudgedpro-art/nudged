// The Nudged routine, server-side. Runs every 15 minutes from pg_cron, or for
// one user right after they connect, or on demand from the app ("Sync now").
//
// Per user: mint an access token from the Vault refresh token, read new
// human-to-human mail from the last 3 days plus any thread attached to an
// open note, triage cheaply (Haiku), extract commitments and dated plans
// (Sonnet), keep one living note per item, write/patch Calendar events for
// confirmed ones (Pro), nudge on silence. Free plan: no calendar writes, 30 open notes. Only extracted items are stored; message
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
import {
  type Note, TRIAGE_MODEL, EXTRACT_MODEL, TRIAGE_SYSTEM, EXTRACT_SYSTEM,
  applyActions, claude, compactOpen, describe, eventTimes, parseJson, todayIn, addDays,
} from "../_shared/notes.ts";
import { planFor } from "../_shared/plan.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const MAX_USERS_PER_RUN = 25;
const MAX_MESSAGES_PER_USER = 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-cron-secret" } });
}

// ---------------------------------------------------------- per-user sync
async function syncUser(userId: string): Promise<{ messages: number; created: number; updated: number; nudges: number }> {
  const stats = { messages: 0, created: 0, updated: 0, nudges: 0 };
  const { data: conn } = await admin.from("google_connections").select("user_id,email,status,history_id").eq("user_id", userId).maybeSingle();
  if (!conn || conn.status !== "active") return stats;
  const { data: prof } = await admin.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const tz = prof?.timezone ?? "America/Toronto";
  const today = todayIn(tz);
  const plan = await planFor(admin, userId);

  const { data: rt } = await admin.rpc("read_google_refresh_token", { p_user_id: userId });
  if (!rt) throw new RevokedError("no refresh token on file");
  const token = await accessTokenFromRefresh(rt as string);

  // 1. Open notes
  const { data: notesRaw } = await admin.from("notes").select("*").eq("user_id", userId);
  const notes = (notesRaw ?? []) as Note[];
  const open = notes.filter((n) => n.status === "pending" || n.status === "scheduled");
  const byDoc = new Map(notes.map((n) => [n.doc_id, n]));

  // 2. Candidate messages: recent search + threads of open notes
  const q = `newer_than:${Math.max(plan.limits.lookback_days, 3)}d -category:promotions -category:social -category:forums`;
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
  let droppedAtCap = 0;
  if (kept.length) {
    const user = JSON.stringify({
      user_email: conn.email, timezone: tz, today,
      open_notes: compactOpen(open),
      messages: kept.map((m) => ({ id: m.id, threadId: m.threadId, from: m.from, to: m.to, subject: m.subject, date: m.isoDate, from_user: m.from.toLowerCase().includes(conn.email.toLowerCase()), text: m.text.slice(0, 2500) })),
    });
    // deno-lint-ignore no-explicit-any
    let actions: any[] = [];
    try { actions = parseJson<{ actions: unknown[] }>(await claude(EXTRACT_MODEL, EXTRACT_SYSTEM, user, 6000)).actions ?? []; }
    catch (e) { console.warn("extract", (e as Error).message); }

    const res = applyActions(byDoc, actions, {
      userId, source: "email",
      sourceUrlFor: (threads) => { const m = kept.find((x) => threads.includes(x.threadId)); return m ? `https://mail.google.com/mail/#all/${m.threadId}` : null; },
      msgsFor: (threads) => msgs.filter((m) => threads.includes(m.threadId)).length,
      subjectFor: (threads) => kept.find((x) => threads.includes(x.threadId))?.subject ?? null,
      openNotesCap: plan.limits.open_notes, openCount: open.length,
    });
    for (const [k, v] of res.changed) changed.set(k, v);
    stats.created += res.created; stats.updated += res.updated; droppedAtCap = res.droppedAtCap;
  }
  if (droppedAtCap) console.warn("free plan cap", userId, droppedAtCap, "notes not created");

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

  // 6. Calendar (Pro only)
  for (const n of changed.values()) {
    if (!plan.limits.calendar_writes) break;
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
  return (await planFor(admin, userId)).valid;
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
