import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl: string; supabaseKey: string; siteUrl: string };
export const SUPABASE_URL = extra.supabaseUrl;
export const SITE_URL = extra.siteUrl ?? "https://nudged.pro";
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export const supabase = createClient(SUPABASE_URL, extra.supabaseKey, {
  auth: {
    // AsyncStorage touches window on web; let supabase-js use localStorage there (and nothing during server render).
    ...(Platform.OS === "web" ? {} : { storage: AsyncStorage }),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type NoteStatus = "pending" | "scheduled" | "done" | "dismissed" | "cancelled";
export interface Clip { at: string; from: string; text: string; subject?: string }
export interface Note {
  id: string; doc_id: string; title: string; kind: "commitment" | "event"; status: NoteStatus;
  manual: boolean; needs_me: boolean; who: string; expected: string | null; expected_end: string | null;
  time: string | null; time_end: string | null; location: string | null; threads: string[]; msgs: number;
  event: string | null; event_url: string | null; source_url: string | null; subject: string | null;
  nudged: string | null; note: string; clips: Clip[]; created_at: string; updated_at: string; closed_at: string | null;
}
export interface Connection { email: string; status: string; last_sync_at: string | null; last_error: string | null }
export interface Licence { plan: string; status: string; current_period_end: string | null; trial_ends_at: string | null }

/** Call one of the Nudged edge functions with the current session. */
export async function callFn<T = any>(name: string, body: unknown = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${name} failed (${r.status})`);
  return j as T;
}

export function groupNotes(notes: Note[]) {
  const g = { need: [] as Note[], wait: [] as Note[], cal: [] as Note[], closed: [] as Note[] };
  for (const n of notes) {
    if (n.status === "scheduled") g.cal.push(n);
    else if (n.status === "pending") (n.needs_me ? g.need : g.wait).push(n);
    else g.closed.push(n);
  }
  g.cal.sort((a, b) => (a.expected ?? "9999").localeCompare(b.expected ?? "9999"));
  return g;
}

export function whenLabel(n: Note): string {
  if (!n.expected) return "no date yet";
  const d = new Date(n.expected + "T12:00:00");
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const end = n.expected_end ? " → " + new Date(n.expected_end + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return `${day}${end}${n.time ? " · " + n.time : ""}`;
}

export function statusLabel(n: Note): string {
  switch (n.status) {
    case "scheduled": return "On calendar";
    case "done": return "Done";
    case "dismissed": return "Dismissed";
    case "cancelled": return "Cancelled";
    default: return n.needs_me ? "Needs you" : "Waiting on them";
  }
}
