// Google helpers shared by the Nudged edge functions.
// Access tokens are minted per job from the refresh token and never stored.

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export class RevokedError extends Error {}

export async function exchangeCode(code: string, redirectUri: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token exchange failed: ${j.error ?? r.status} ${j.error_description ?? ""}`);
  return j as { access_token: string; refresh_token?: string; id_token?: string; scope: string; expires_in: number };
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    if (j.error === "invalid_grant") throw new RevokedError("Google access was revoked or expired");
    throw new Error(`refresh failed: ${j.error ?? r.status}`);
  }
  return j.access_token as string;
}

export async function revokeToken(token: string) {
  await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(token), { method: "POST" }).catch(() => {});
}

// id_token came straight from Google's token endpoint over TLS; decoding is enough here.
export function decodeIdToken(idToken: string): { sub: string; email: string; email_verified?: boolean } {
  const payload = idToken.split(".")[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}

async function gapi<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (r.status === 401) throw new RevokedError("Google rejected the access token");
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${url.split("?")[0]} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  if (r.status === 204) return {} as T;
  return await r.json() as T;
}

// ------------------------------------------------------------------ Gmail
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function gmailProfile(token: string) {
  return gapi<{ emailAddress: string; historyId: string }>(token, `${GMAIL}/profile`);
}

export async function gmailSearch(token: string, q: string, max = 100): Promise<{ id: string; threadId: string }[]> {
  const out: { id: string; threadId: string }[] = [];
  let pageToken = "";
  for (let page = 0; page < 3 && out.length < max; page++) {
    const u = new URL(`${GMAIL}/messages`);
    u.searchParams.set("q", q);
    u.searchParams.set("maxResults", String(Math.min(100, max - out.length)));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const j = await gapi<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(token, u.toString());
    out.push(...(j.messages ?? []));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

export async function gmailThreadMessageIds(token: string, threadId: string): Promise<{ id: string; threadId: string }[]> {
  const j = await gapi<{ messages?: { id: string; threadId: string }[] }>(token, `${GMAIL}/threads/${threadId}?format=minimal`);
  return j.messages ?? [];
}

export interface ParsedMessage {
  id: string; threadId: string; from: string; to: string; subject: string;
  date: string; isoDate: string; text: string; automated: boolean; listUnsubscribe: boolean;
}

function b64url(s: string): string {
  try { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))); }
  catch { return ""; }
}

function stripHtml(h: string): string {
  return h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// deno-lint-ignore no-explicit-any
function bodyText(payload: any): string {
  let plain = "", html = "";
  // deno-lint-ignore no-explicit-any
  const walk = (p: any) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = b64url(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = b64url(p.body.data);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  const t = plain || stripHtml(html);
  // Drop quoted history: everything from the first "On ... wrote:" line on.
  return t.split(/\n(?=On .{5,120} wrote:)/)[0].replace(/^>.*$/gm, "").trim();
}

export async function gmailMessage(token: string, id: string): Promise<ParsedMessage> {
  // deno-lint-ignore no-explicit-any
  const m = await gapi<any>(token, `${GMAIL}/messages/${id}?format=full`);
  const h = (name: string) => (m.payload?.headers ?? []).find((x: { name: string }) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  const from = h("From"), to = h("To"), subject = h("Subject"), date = h("Date");
  const listUnsub = !!h("List-Unsubscribe") || /bulk|list/i.test(h("Precedence"));
  const automated = listUnsub || /no-?reply|do-?not-?reply|notification|mailer-daemon|newsletter|marketing|alerts?@|info@|news@|hello@|team@|support@|billing@|receipts?@|orders?@/i.test(from);
  const ms = Number(m.internalDate ?? 0);
  return {
    id: m.id, threadId: m.threadId, from, to, subject, date,
    isoDate: ms ? new Date(ms).toISOString() : new Date().toISOString(),
    text: bodyText(m.payload).slice(0, 4000), automated, listUnsubscribe: listUnsub,
  };
}

// --------------------------------------------------------------- Calendar
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export interface EventInput {
  summary: string; description: string; location?: string | null;
  allDay: boolean; start: string; end: string; timeZone: string;  // all-day: YYYY-MM-DD (end exclusive); timed: local ISO without offset
}

function eventBody(e: EventInput) {
  return {
    summary: e.summary, description: e.description, location: e.location ?? undefined,
    start: e.allDay ? { date: e.start } : { dateTime: e.start, timeZone: e.timeZone },
    end: e.allDay ? { date: e.end } : { dateTime: e.end, timeZone: e.timeZone },
    transparency: e.allDay ? "transparent" : "opaque",
  };
}

export async function calendarInsert(token: string, e: EventInput) {
  return gapi<{ id: string; htmlLink: string }>(token, CAL, { method: "POST", body: JSON.stringify(eventBody(e)) });
}

export async function calendarPatch(token: string, id: string, e: Partial<EventInput> & { summary?: string; description?: string }) {
  // deno-lint-ignore no-explicit-any
  const body: any = {};
  if (e.summary !== undefined) body.summary = e.summary;
  if (e.description !== undefined) body.description = e.description;
  if (e.location !== undefined) body.location = e.location ?? "";
  if (e.start && e.end && e.timeZone !== undefined) {
    body.start = e.allDay ? { date: e.start } : { dateTime: e.start, timeZone: e.timeZone };
    body.end = e.allDay ? { date: e.end } : { dateTime: e.end, timeZone: e.timeZone };
  }
  return gapi<{ id: string; htmlLink: string }>(token, `${CAL}/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}
