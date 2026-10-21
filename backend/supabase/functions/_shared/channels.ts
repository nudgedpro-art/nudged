// Process one hand-off message (WhatsApp forward or share-sheet) into a note.
// Shared by whatsapp-webhook and ingest. Never stores the body past processing.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { RevokedError, accessTokenFromRefresh, calendarInsert, calendarPatch } from "./google.ts";
import { type Note, EXTRACT_MODEL, FORWARD_SYSTEM, applyActions, claude, compactOpen, describe, eventTimes, parseJson, todayIn } from "./notes.ts";
import { planFor } from "./plan.ts";

export type Outcome = "added" | "updated" | "nothing_found" | "needs_from" | "plan_blocked" | "unlinked" | "error";
export interface ProcessResult { outcome: Outcome; reply: string; note?: Note }

export const UPGRADE_URL = "https://nudged.pro/#pro";

function whenLine(n: Note): string {
  if (!n.expected) return "";
  const d = new Date(n.expected + "T00:00:00Z");
  const s = d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return s + (n.time ? " " + n.time : "");
}

export function replyFor(r: ProcessResult): string {
  switch (r.outcome) {
    case "added": return `Got it: "${r.note!.title}"${r.note!.who ? ", " + r.note!.who : ""}${whenLine(r.note!) ? ", " + whenLine(r.note!) : ""} is on your board${r.note!.event ? " and your calendar" : ""}.`;
    case "updated": return `Added that to "${r.note!.title}" on your board${r.note!.event ? "; calendar updated" : ""}.`;
    case "needs_from": return `Got it. Who is that from? Reply with a name and I'll file it.`;
    case "nothing_found": return `I couldn't find a promise or a date in that. Nothing added.`;
    case "plan_blocked": return `Forwarding is part of Nudged Pro. Start your 14-day trial at ${UPGRADE_URL}`;
    case "unlinked": return `This number isn't linked to a Nudged account yet. Open the Nudged app, go to Settings, and tap Connect WhatsApp.`;
    default: return `Something went wrong on my side. I'll try that message again shortly.`;
  }
}

/**
 * Run extraction for one inbound_messages row. Updates the row (outcome, note_id,
 * processed_at, body → null) and upserts the note. Returns what to tell the user.
 */
export async function processInbound(admin: SupabaseClient, inboundId: string): Promise<ProcessResult> {
  const { data: inb } = await admin.from("inbound_messages").select("*").eq("id", inboundId).maybeSingle();
  if (!inb) return { outcome: "error", reply: replyFor({ outcome: "error", reply: "" }) };
  const finish = async (outcome: Outcome, noteId: string | null = null, keepBody = false) => {
    await admin.from("inbound_messages").update({
      outcome, note_id: noteId, processed_at: keepBody ? null : new Date().toISOString(),
      body: keepBody ? inb.body : null, attempts: (inb.attempts ?? 0) + 1,
    }).eq("id", inboundId);
  };

  if (!inb.user_id) { await finish("unlinked"); return { outcome: "unlinked", reply: replyFor({ outcome: "unlinked", reply: "" }) }; }
  const plan = await planFor(admin, inb.user_id);
  if (!plan.limits.forward) { await finish("plan_blocked"); return { outcome: "plan_blocked", reply: replyFor({ outcome: "plan_blocked", reply: "" }) }; }

  const body = String(inb.body ?? "").trim();
  if (body.length < 3) { await finish("nothing_found"); return { outcome: "nothing_found", reply: replyFor({ outcome: "nothing_found", reply: "" }) }; }

  const { data: prof } = await admin.from("profiles").select("timezone,email").eq("id", inb.user_id).maybeSingle();
  const tz = prof?.timezone ?? "America/Toronto";
  const today = todayIn(tz);

  const { data: notesRaw } = await admin.from("notes").select("*").eq("user_id", inb.user_id);
  const notes = (notesRaw ?? []) as Note[];
  const open = notes.filter((n) => n.status === "pending" || n.status === "scheduled");
  const byDoc = new Map(notes.map((n) => [n.doc_id, n]));

  // deno-lint-ignore no-explicit-any
  let out: { actions?: any[]; needs_from?: boolean } = {};
  try {
    out = parseJson(await claude(EXTRACT_MODEL, FORWARD_SYSTEM, JSON.stringify({
      user_email: prof?.email ?? "", timezone: tz, today, channel: inb.channel,
      from_hint: inb.from_hint ?? "", open_notes: compactOpen(open), text: body.slice(0, 4000),
    }), 3000));
  } catch (e) {
    console.warn("forward extract", (e as Error).message);
    // Keep the body for one retry by the sweep; after that it is scrubbed.
    await finish("error", null, (inb.attempts ?? 0) < 1);
    return { outcome: "error", reply: replyFor({ outcome: "error", reply: "" }) };
  }

  if (out.needs_from && !inb.from_hint) { await finish("needs_from", null, true); return { outcome: "needs_from", reply: replyFor({ outcome: "needs_from", reply: "" }) }; }
  const actions = Array.isArray(out.actions) ? out.actions : [];
  const res = applyActions(byDoc, actions, {
    userId: inb.user_id, source: inb.channel as "whatsapp" | "share", sourceRef: inboundId,
    openNotesCap: plan.limits.open_notes, openCount: open.length,
  });
  if (res.changed.size === 0) { await finish("nothing_found"); return { outcome: "nothing_found", reply: replyFor({ outcome: "nothing_found", reply: "" }) }; }

  // Calendar, Pro only, best effort.
  if (plan.limits.calendar_writes) {
    try {
      const { data: rt } = await admin.rpc("read_google_refresh_token", { p_user_id: inb.user_id });
      if (rt) {
        const token = await accessTokenFromRefresh(rt as string);
        for (const n of res.changed.values()) {
          const times = eventTimes(n, tz);
          try {
            if (n.event) await calendarPatch(token, n.event, { summary: (n.status === "cancelled" ? "❌ " : "📌 ") + n.title, description: describe(n), location: n.location, ...(times ?? {}) });
            else if (n.status === "scheduled" && times) { const ev = await calendarInsert(token, { summary: "📌 " + n.title, description: describe(n), location: n.location, ...times }); n.event = ev.id; n.event_url = ev.htmlLink; }
          } catch (e) { console.warn("calendar", n.doc_id, (e as Error).message); }
        }
      }
    } catch (e) { if (!(e instanceof RevokedError)) console.warn("calendar token", (e as Error).message); }
  }

  let first: Note | undefined;
  for (const n of res.changed.values()) {
    const { error } = await admin.from("notes").upsert(n, { onConflict: "user_id,doc_id" });
    if (error) console.warn("note upsert", n.doc_id, error.message); else first ??= n;
  }
  const outcome: Outcome = res.created > 0 ? "added" : "updated";
  await finish(outcome, first?.id ?? null);
  const r: ProcessResult = { outcome, reply: "", note: first };
  r.reply = replyFor(r);
  return r;
}
