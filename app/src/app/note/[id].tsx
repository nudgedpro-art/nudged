import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Note, statusLabel, supabase, whenLabel } from "../../lib/supabase";
import { C, F } from "../../lib/theme";

export default function NoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [n, setN] = useState<Note | null>(null);

  const load = async () => { const { data } = await supabase.from("notes").select("*").eq("id", id).maybeSingle(); setN(data as Note); };
  useEffect(() => { load(); }, [id]);

  const setStatus = async (status: Note["status"]) => {
    const patch = status === "pending" ? { status, closed_at: null } : { status, closed_at: new Date().toISOString() };
    const { error } = await supabase.from("notes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) Alert.alert("Could not update", error.message); else router.back();
  };

  if (!n) return <View style={s.root} />;
  const open = n.status === "pending" || n.status === "scheduled";
  const bg = n.status === "scheduled" ? C.cal : n.needs_me && n.status === "pending" ? C.need : C.paper;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: statusLabel(n) }} />
      <View style={[s.card, { backgroundColor: bg }]}>
        <Text style={F.tag}>{n.kind === "event" ? "Plan" : "Commitment"} · {statusLabel(n)}</Text>
        <Text style={s.title}>{n.title}</Text>
        <Text style={F.body}>{whenLabel(n)}</Text>
        {!!n.who && <Text style={F.body}>With {n.who}</Text>}
        {!!n.location && <Text style={F.body}>At {n.location}</Text>}
        {!!n.note && <Text style={[F.body, { marginTop: 8 }]}>{n.note}</Text>}
      </View>

      <View style={s.row}>
        {n.source_url && <Pressable style={s.linkBtn} onPress={() => Linking.openURL(n.source_url!)}><Text style={s.linkText}>Open email</Text></Pressable>}
        {n.event_url && <Pressable style={s.linkBtn} onPress={() => Linking.openURL(n.event_url!)}><Text style={s.linkText}>Open calendar event</Text></Pressable>}
      </View>

      <Text style={s.h2}>What's been said</Text>
      {n.clips.length === 0 && <Text style={F.small}>Nothing yet.</Text>}
      {[...n.clips].reverse().map((c, i) => (
        <View key={i} style={s.clip}>
          <Text style={F.small}>{c.at} · {c.from}</Text>
          <Text style={F.body}>{c.text}</Text>
        </View>
      ))}

      <View style={[s.row, { marginTop: 24 }]}>
        {open ? (
          <>
            <Pressable style={s.btn} onPress={() => setStatus("done")}><Text style={s.btnText}>Done</Text></Pressable>
            <Pressable style={[s.btn, s.ghost]} onPress={() => setStatus("dismissed")}><Text style={[s.btnText, { color: C.ink }]}>Dismiss</Text></Pressable>
          </>
        ) : (
          <Pressable style={[s.btn, s.ghost]} onPress={() => setStatus("pending")}><Text style={[s.btnText, { color: C.ink }]}>Reopen</Text></Pressable>
        )}
      </View>
      <Text style={[F.small, { marginTop: 12 }]}>Done and Dismiss freeze the note: Nudged stops updating it and leaves its calendar event alone. Nothing is ever deleted from your email or calendar.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.board },
  content: { padding: 16, paddingBottom: 48 },
  card: { padding: 18, gap: 6, shadowColor: "#282d23", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 2, height: 3 }, elevation: 3 },
  title: { fontSize: 24, fontWeight: "700", color: C.ink, marginBottom: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: C.card },
  linkText: { color: C.ink, fontWeight: "600" },
  h2: { ...F.h2, marginTop: 24, marginBottom: 8 },
  clip: { backgroundColor: C.card, padding: 12, borderRadius: 10, marginBottom: 8, gap: 2 },
  btn: { backgroundColor: C.btn, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12 },
  ghost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.ink },
  btnText: { color: C.btnInk, fontSize: 16, fontWeight: "600" },
});
