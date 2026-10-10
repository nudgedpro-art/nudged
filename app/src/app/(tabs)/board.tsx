import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { callFn, groupNotes, Note, statusLabel, supabase, whenLabel, type Connection } from "../../lib/supabase";
import { C, F } from "../../lib/theme";

export default function Board() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [conn, setConn] = useState<Connection | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: n, error }, { data: c }] = await Promise.all([
      supabase.from("notes").select("*").order("updated_at", { ascending: false }),
      supabase.from("google_connections").select("email,status,last_sync_at,last_error").maybeSingle(),
    ]);
    if (error) setMsg(error.message); else setNotes((n ?? []) as Note[]);
    setConn((c as Connection) ?? null);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const syncNow = async () => {
    setRefreshing(true); setMsg("Syncing…");
    try { const r = await callFn("nudged-sync"); const s = r.results?.[0]; setMsg(s?.error ? s.error : s?.skipped ? s.skipped : `Synced: ${s?.created ?? 0} new, ${s?.updated ?? 0} updated`); }
    catch (e) { setMsg((e as Error).message); }
    await load(); setRefreshing(false);
  };

  const g = groupNotes(notes);
  const sections = [
    { title: "Needs you", data: g.need },
    { title: "Waiting on them", data: g.wait },
    { title: "On the calendar", data: g.cal },
    { title: "Closed", data: g.closed.slice(0, 20) },
  ];

  const status = conn
    ? conn.status !== "active" ? `Google ${conn.status}. Reconnect in Settings.`
      : conn.last_error ? `Last sync failed: ${conn.last_error}`
      : conn.last_sync_at ? `Last sync ${new Date(conn.last_sync_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "First sync pending"
    : "No Google connection yet";

  return (
    <SectionList
      sections={sections}
      keyExtractor={(n) => n.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={syncNow} tintColor={C.ink} />}
      ListHeaderComponent={<Text style={s.status}>{msg ?? status}</Text>}
      renderSectionHeader={({ section }) => <Text style={s.h2}>{section.title}</Text>}
      renderSectionFooter={({ section }) => section.data.length ? null : <View style={s.empty}><Text style={F.small}>Nothing here.</Text></View>}
      renderItem={({ item: n }) => (
        <Pressable onPress={() => router.push({ pathname: "/note/[id]", params: { id: n.id } })} style={[s.card, n.status === "scheduled" ? { backgroundColor: C.cal } : n.needs_me && n.status === "pending" ? { backgroundColor: C.need } : null, n.status !== "pending" && n.status !== "scheduled" ? { opacity: 0.7 } : null]}>
          <Text style={F.tag}>{statusLabel(n)}</Text>
          <Text style={s.title}>{n.title}</Text>
          <Text style={F.small}>{whenLabel(n)}{n.who ? ` · ${n.who}` : ""}</Text>
          {!!n.note && <Text style={s.note} numberOfLines={3}>{n.note}</Text>}
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  list: { padding: 16, paddingBottom: 48, gap: 6 },
  status: { ...F.small, marginBottom: 8 },
  h2: { ...F.h2, marginTop: 18, marginBottom: 8 },
  empty: { backgroundColor: C.card, padding: 14, borderRadius: 10 },
  card: { backgroundColor: C.paper, padding: 14, marginBottom: 12, gap: 4, shadowColor: "#282d23", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 2, height: 3 }, elevation: 3 },
  title: { fontSize: 18, fontWeight: "700", color: C.ink },
  note: { ...F.body, fontSize: 15, lineHeight: 21, marginTop: 2 },
});
