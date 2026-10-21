// Note shape, Claude calls and helpers shared by nudged-sync (email) and the
// hand-off channels (WhatsApp forward, share-sheet). One extraction vocabulary,
// one apply routine, so every channel produces identical notes.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
export const TRIAGE_MODEL = Deno.env.get("TRIAGE_MODEL") ?? "claude-haiku-4-5-20251001";
export const EXTRACT_MODEL = Deno.env.get("EXTRACT_MODEL") ?? "claude-sonnet-5-5";
export const MARK = "— Nudged, kept up to date automatically.";

export type NoteSource = "email" | "whatsapp" | "share" | "imessage";

export type Note = {
  id: string; user_id: string; doc_id: string; title: string; kind: "commitment" | "event";
  status: "pending" | "scheduled" | "done" | "dismissed" | "cancelled"; manual: boolean; needs_me: boolean;
  who: string; expected: string | null; expected_end: string | null; time: string | null; time_end: string | null;
  location: string | null; threads: string[]; msgs: number; event: string | null; event_url: string | null;
  source_url: string | null; subject: string | null; nudged: string | null; note: string;
  clips: { at: string; from: string; text: string; subject?: string }[]; updated_at: string; closed_at: string | null;
  source: NoteSource; source_ref: string | null;
};

// ------------------------------------------------------------- Anthropic
export async function claude(model: string, system: string, user: string, maxTokens = 4000): Promise<string> {
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
export function parseJson<T>(s: string): T {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m ? m[1] : s).trim();
  const start = body.search(/[\[{]/);
  return JSON.parse(body.slice(start)) as T;
}

export const TRIAGE_SYSTEM = `You triage email for a follow-up assistant. For each message decide KEEP or SKIP.
KEEP only human-to-human mail that contains a real commitment (someone promises to do, send, deliver, pay, confirm, call, or decide something, with or without a date) or a real dated plan (an appointment, visit, trip, dinner, meeting, delivery or pickup on a stated day).
SKIP newsletters, receipts, order confirmations, calendar invitations, developer-tool alerts, marketing, no-reply senders, mailing lists, mass forwards, social notifications, and anything with no concrete follow-up. EXCEPTION: keep a shipping, delivery, pickup or return notice that names a specific date for the recipient's own address.
When unsure, SKIP. Answer with JSON only: {"keep":["<id>",...]}`;

const RULES = `Rules
- Resolve relative dates against each message's own send date in the user's timezone ("Friday" written on a Tuesday is that coming Friday). Dates are YYYY-MM-DD, times HH:MM 24h local.
- Match a message to an existing note first by thread id, then by same other party plus same date, then by clearly the same topic. Create a new note only when nothing matches.
- kind "commitment": an open loop someone owes someone. status "pending" until a firm date/time exists, then "scheduled".
- kind "event": a dated plan. "scheduled" immediately when it has a date.
- needs_me: true when the next move belongs to the user (a reply they owe, something they promised).
- who: "Name, organisation" of the other party, never an email address or phone number.
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

export const EXTRACT_SYSTEM = `You maintain a board of living notes for one person: one note per commitment or dated plan found in their email. You receive their open notes and new messages. Return JSON only.

${RULES}`;

// A single message the user forwarded or shared by hand. No thread, no headers;
// the other party is whatever the text and from_hint say.
export const FORWARD_SYSTEM = `You maintain a board of living notes for one person: one note per commitment or dated plan. The person has just FORWARDED one message to you by hand from WhatsApp, a text, or another app, because they think it holds a promise or a dated plan. You receive their open notes, the forwarded text, the channel, and a from_hint: who they say it is from (may be empty). Return JSON only.

Extra rules for forwarded messages
- The message was written by the other party unless the text clearly shows the user wrote it (e.g. it starts "I'll" and the from_hint is empty and it reads as the user's own words). Set needs_me accordingly.
- "threads" must be an empty array; set "subject" to a 3–6 word gist of the message.
- If the text holds a promise or dated plan but names nobody and from_hint is empty, return {"actions":[],"needs_from":true} so the person can be asked who it is from. If from_hint is given, use it as "who".
- If the text holds no promise and no dated plan, return {"actions":[]}.
- Resolve relative dates against today in the user's timezone (the message was received today unless it states a date).

${RULES}`;

// --------------------------------------------------------------- helpers
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number); return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
}
export function describe(n: Note): string {
  const lines = [n.note, ""];
  if (n.who) lines.push(`Who: ${n.who}`);
  if (n.expected) lines.push(`When: ${n.expected}${n.expected_end ? " to " + n.expected_end : ""}${n.time ? " " + n.time : ""}${n.time_end ? "–" + n.time_end : ""}`);
  if (n.location) lines.push(`Where: ${n.location}`);
  const recent = n.clips.slice(-5);
  if (recent.length) { lines.push("", "Latest:"); for (const c of recent) lines.push(`• ${c.at} ${c.from}: ${c.text}`); }
  const src = n.source === "email" ? `Source: ${n.subject ?? ""}` : `Source: forwarded from ${n.source === "whatsapp" ? "WhatsApp" : n.source === "imessage" ? "Messages" : "another app"}`;
  lines.push("", `${MARK} ${src}`);
  return lines.join("\n").slice(0, 1500);
}
export function eventTimes(n: Note, tz: string) {
  if (!n.expected) return null;
  if (n.time) {
    const end = n.time_end ?? addHour(n.time);
    const endDate = n.time_end && n.time_end < n.time ? addDays(n.expected, 1) : (n.expected_end ?? n.expected);
    return { allDay: false, start: `${n.expected}T${n.time}:00`, end: `${endDate}T${end}:00`, timeZone: tz };
  }
  return { allDay: true, start: n.expected, end: addDays(n.expected_end ?? n.expected, 1), timeZone: tz };
}
export function compactOpen(open: Note[]) {
  return open.map((n) => ({ doc_id: n.doc_id, title: n.title, kind: n.kind, status: n.status, needs_me: n.needs_me, who: n.who, expected: n.expected, time: n.time, threads: n.threads, note: n.note }));
}

// ------------------------------------------------------------ apply
export interface ApplyContext {
  userId: string;
  source: NoteSource;
  sourceRef?: string | null;
  /** Gmail: viewUrl of the thread a created note points at. Other channels: null. */
  sourceUrlFor?: (threads: string[]) => string | null;
  /** Gmail: how many fetched messages belong to these threads. Other channels: 0. */
  msgsFor?: (threads: string[]) => number;
  /** Gmail: subject of the main thread, when the model gave none. */
  subjectFor?: (threads: string[]) => string | null;
  /** Free plan cap on open notes; null = unlimited. Creates beyond it are dropped and counted. */
  openNotesCap?: number | null;
  openCount?: number;
}

export interface ApplyResult { changed: Map<string, Note>; created: number; updated: number; droppedAtCap: number }

// deno-lint-ignore no-explicit-any
export function applyActions(byDoc: Map<string, Note>, actions: any[], ctx: ApplyContext): ApplyResult {
  const changed = new Map<string, Note>();
  const res: ApplyResult = { changed, created: 0, updated: 0, droppedAtCap: 0 };
  const now = new Date().toISOString();
  let openCount = ctx.openCount ?? 0;
  for (const a of actions) {
    try {
      if (a.op === "create") {
        if (ctx.openNotesCap != null && openCount >= ctx.openNotesCap) { res.droppedAtCap++; continue; }
        let docId = slug(a.doc_id || a.title); let i = 2;
        while (byDoc.has(docId)) docId = `${slug(a.doc_id || a.title)}-${i++}`;
        const threads: string[] = (a.threads ?? []).filter((t: string) => typeof t === "string");
        const n: Note = {
          id: crypto.randomUUID(), user_id: ctx.userId, doc_id: docId, title: String(a.title ?? "Untitled").slice(0, 120),
          kind: a.kind === "event" ? "event" : "commitment",
          status: a.status === "scheduled" && a.expected ? "scheduled" : "pending",
          manual: false, needs_me: !!a.needs_me, who: String(a.who ?? ""), expected: a.expected ?? null, expected_end: a.expected_end ?? null,
          time: a.time ?? null, time_end: a.time_end ?? null, location: a.location ?? null,
          threads, msgs: ctx.msgsFor ? ctx.msgsFor(threads) : 0, event: null, event_url: null,
          source_url: ctx.sourceUrlFor ? ctx.sourceUrlFor(threads) : null,
          subject: a.subject ?? (ctx.subjectFor ? ctx.subjectFor(threads) : null) ?? null,
          nudged: null, note: String(a.note ?? ""), clips: a.clip ? [a.clip] : [], updated_at: now, closed_at: null,
          source: ctx.source, source_ref: ctx.sourceRef ?? null,
        };
        byDoc.set(docId, n); changed.set(docId, n); res.created++; openCount++;
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
        if (ctx.msgsFor) n.msgs += ctx.msgsFor(n.threads);
        const st = n.status as Note["status"];   // the patch above may have changed it; TS cannot see that
        if (st === "pending" && n.kind === "event" && n.expected) n.status = "scheduled";
        if ((st === "done" || st === "cancelled") && !n.closed_at) n.closed_at = now;
        n.updated_at = now;
        changed.set(n.doc_id, n); res.updated++;
      }
    } catch (e) { console.warn("action", (e as Error).message); }
  }
  return res;
}
