import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../lib/session";
import { callFn, SITE_URL, supabase, type Connection, type Licence } from "../../lib/supabase";
import { C, F } from "../../lib/theme";

export default function Settings() {
  const { session, signOut, connectGoogle } = useSession();
  const [conn, setConn] = useState<Connection | null>(null);
  const [lic, setLic] = useState<Licence | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: c }, { data: l }] = await Promise.all([
      supabase.from("google_connections").select("email,status,last_sync_at,last_error").maybeSingle(),
      supabase.from("my_license").select("*").maybeSingle(),
    ]);
    setConn((c as Connection) ?? null); setLic((l as Licence) ?? null);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (label: string, f: () => Promise<void>) => { setBusy(label); try { await f(); } catch (e) { Alert.alert(label, (e as Error).message); } finally { setBusy(null); await load(); } };

  const disconnect = () => Alert.alert("Disconnect Google?", "Nudged stops reading your mail. Your notes stay. You can reconnect any time.", [
    { text: "Cancel", style: "cancel" },
    { text: "Disconnect", style: "destructive", onPress: () => run("Disconnect", async () => { await callFn("google-auth/disconnect"); }) },
  ]);

  const deleteAccount = () => Alert.alert("Delete your account?", "Every note, your Google connection and your Nudged account are deleted, and Nudged's access at Google is revoked. This cannot be undone. Cancel any paid subscription first from your Stripe receipt.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete everything", style: "destructive", onPress: () => run("Delete", async () => { await callFn("account-delete"); await signOut(); router.replace("/onboarding"); }) },
  ]);

  const licLine = lic
    ? lic.plan === "trial"
      ? `Free trial until ${lic.trial_ends_at?.slice(0, 10) ?? "?"}`
      : `${lic.plan[0].toUpperCase() + lic.plan.slice(1)} plan, ${lic.status}${lic.current_period_end ? ", renews " + lic.current_period_end.slice(0, 10) : ""}`
    : "No licence found";

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h2}>Account</Text>
      <View style={s.box}>
        <Text style={F.body}>{session?.user.email}</Text>
        <Text style={F.small}>{licLine}</Text>
        <Text style={F.small}>Subscriptions are managed on nudged.pro, not in this app.</Text>
      </View>

      <Text style={s.h2}>Google</Text>
      <View style={s.box}>
        <Text style={F.body}>{conn ? `${conn.email} · ${conn.status}` : "Not connected"}</Text>
        {conn?.last_sync_at && <Text style={F.small}>Last sync {new Date(conn.last_sync_at).toLocaleString()}</Text>}
        {conn?.last_error && <Text style={[F.small, { color: C.danger }]}>{conn.last_error}</Text>}
        <View style={s.row}>
          {(!conn || conn.status !== "active") && <Pressable style={s.btn} disabled={!!busy} onPress={() => run("Connect", async () => { const r = await connectGoogle(); if (!r.ok) throw new Error(r.error); })}><Text style={s.btnText}>Connect Google</Text></Pressable>}
          {conn?.status === "active" && <Pressable style={[s.btn, s.ghost]} disabled={!!busy} onPress={() => run("Sync", async () => { await callFn("nudged-sync"); })}><Text style={[s.btnText, { color: C.ink }]}>{busy === "Sync" ? "Syncing…" : "Sync now"}</Text></Pressable>}
          {conn?.status === "active" && <Pressable style={[s.btn, s.ghost]} disabled={!!busy} onPress={disconnect}><Text style={[s.btnText, { color: C.ink }]}>Disconnect</Text></Pressable>}
        </View>
      </View>

      <Text style={s.h2}>About</Text>
      <View style={s.box}>
        <Pressable onPress={() => Linking.openURL(`${SITE_URL}/privacy.html`)}><Text style={s.link}>Privacy policy</Text></Pressable>
        <Pressable onPress={() => Linking.openURL(`${SITE_URL}/terms.html`)}><Text style={s.link}>Terms</Text></Pressable>
        <Pressable onPress={() => Linking.openURL("mailto:hello@nudged.pro")}><Text style={s.link}>hello@nudged.pro</Text></Pressable>
        <Text style={F.small}>Nudged is made by Dockhand Inc., Ontario, Canada.</Text>
      </View>

      <View style={[s.row, { marginTop: 24 }]}>
        <Pressable style={[s.btn, s.ghost]} onPress={async () => { await signOut(); router.replace("/onboarding"); }}><Text style={[s.btnText, { color: C.ink }]}>Sign out</Text></Pressable>
        <Pressable style={[s.btn, s.dangerBtn]} disabled={!!busy} onPress={deleteAccount}><Text style={[s.btnText, { color: C.danger }]}>Delete account and data</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.board },
  content: { padding: 16, paddingBottom: 48 },
  h2: { ...F.h2, marginTop: 16, marginBottom: 8 },
  box: { backgroundColor: C.card, padding: 14, borderRadius: 12, gap: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  btn: { backgroundColor: C.btn, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  ghost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.ink },
  dangerBtn: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.danger },
  btnText: { color: C.btnInk, fontSize: 15, fontWeight: "600" },
  link: { ...F.body, textDecorationLine: "underline" },
});
