import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../lib/session";
import { C } from "../lib/theme";

export default function Gate() {
  const { session, loading } = useSession();
  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.board }}><ActivityIndicator color={C.ink} /></View>;
  return <Redirect href={session ? "/(tabs)/board" : "/onboarding"} />;
}
