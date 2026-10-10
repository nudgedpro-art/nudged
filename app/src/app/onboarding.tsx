import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../lib/session";
import { SITE_URL } from "../lib/supabase";
import { C, F } from "../lib/theme";

// Three screens, two of them consent screens that app review and Google's
// User Data policy both expect to see BEFORE the OAuth prompt:
//   1. what Nudged is
//   2. Gmail / Calendar prominent disclosure
//   3. AI processing disclosure (Apple 5.1.2(i))
const PAGES = [
  {
    title: "A nudge that travels with you.",
    body: [
      "You reply \"deliver Friday\" and forget. Someone says \"cottage weekend Oct 10\".",
      "Nudged reads your email, keeps one living note per promise or plan, puts the confirmed ones on your calendar, and nudges you when the other side goes quiet.",
    ],
    cta: "How it works",
  },
  {
    title: "What Nudged reads and writes",
    body: [
      "Gmail, read-only. Every 15 minutes Nudged reads your recent human-to-human mail (not promotions, social or forum mail) to find commitments and dated plans. It never sends, replies, archives, labels or deletes anything.",
      "Google Calendar, events only. Confirmed plans become events marked \"— Nudged,\" and Nudged only ever edits the events it created. It never deletes an event.",
      "Nudged stores only the extracted notes (who, what, when) and the ids of the threads they came from. Message bodies are never stored.",
    ],
    cta: "I understand",
  },
  {
    title: "How Nudged understands your mail",
    body: [
      "Relevant email text is sent to Anthropic's Claude models to decide whether a message contains a commitment or a plan, and to write the short note you see.",
      "Anthropic processes that text for Nudged under commercial terms that forbid using it to train AI models. It is not retained after the note is written.",
      "You can disconnect Google or delete your account and all notes at any time from Settings.",
    ],
    cta: "Agree and connect Google",
  },
];

export default function Onboarding() {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { connectGoogle } = useSession();
  const insets = useSafeAreaInsets();
  const p = PAGES[page];

  const next = async () => {
    setError(null);
    if (page < PAGES.length - 1) { setPage(page + 1); return; }
    setBusy(true);
    const r = await connectGoogle();
    setBusy(false);
    if (r.ok) router.replace("/(tabs)/board");
    else setError(r.error ?? "Could not connect");
  };

  return (
    <View style={[s.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.brand}>Nudged</Text>
        <View style={[s.note, page === 1 && { backgroundColor: C.cal }, page === 2 && { backgroundColor: C.need }]}>
          <Text style={s.tag}>{page + 1} of {PAGES.length}</Text>
          <Text style={s.title}>{p.title}</Text>
          {p.body.map((b, i) => <Text key={i} style={s.body}>{b}</Text>)}
        </View>
        {page === 2 && (
          <Text style={F.small}>
            By continuing you agree to the{" "}
            <Text style={s.link} onPress={() => Linking.openURL(`${SITE_URL}/terms.html`)}>Terms</Text> and{" "}
            <Text style={s.link} onPress={() => Linking.openURL(`${SITE_URL}/privacy.html`)}>Privacy policy</Text>.
            Google will ask you to allow both permissions on the next screen; Nudged cannot work with only one.
          </Text>
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </ScrollView>
      <View style={s.actions}>
        {page > 0 && !busy && <Pressable onPress={() => setPage(page - 1)} style={[s.btn, s.ghost]}><Text style={[s.btnText, { color: C.ink }]}>Back</Text></Pressable>}
        <Pressable onPress={next} disabled={busy} style={[s.btn, { flex: 1 }]}>
          {busy ? <ActivityIndicator color={C.btnInk} /> : <Text style={s.btnText}>{p.cta}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.board, paddingHorizontal: 20 },
  scroll: { gap: 18, paddingBottom: 24 },
  brand: { ...F.title, fontSize: 34 },
  note: { backgroundColor: C.paper, padding: 20, gap: 12, shadowColor: "#282d23", shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 2, height: 4 }, elevation: 4, transform: [{ rotate: "-0.6deg" }] },
  tag: F.tag,
  title: { ...F.h2, fontSize: 24 },
  body: F.body,
  link: { textDecorationLine: "underline", color: C.ink },
  error: { color: C.danger, fontSize: 15 },
  actions: { flexDirection: "row", gap: 10, paddingTop: 8 },
  btn: { backgroundColor: C.btn, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.ink },
  btnText: { color: C.btnInk, fontSize: 16, fontWeight: "600" },
});
