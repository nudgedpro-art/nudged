import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Text } from "react-native";
import { useSession } from "../../lib/session";
import { C } from "../../lib/theme";

const Icon = ({ glyph, color }: { glyph: string; color: import("react-native").ColorValue }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function TabsLayout() {
  const { session, loading } = useSession();
  if (!loading && !session) return <Redirect href="/onboarding" />;
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: C.board }, headerShadowVisible: false, headerTintColor: C.ink,
      headerTitleStyle: { fontWeight: "700", fontSize: 22 },
      tabBarStyle: { backgroundColor: C.board, borderTopColor: C.line }, tabBarActiveTintColor: C.ink, tabBarInactiveTintColor: C.muted,
      sceneStyle: { backgroundColor: C.board },
    }}>
      <Tabs.Screen name="board" options={{ title: "Board", tabBarIcon: ({ color }) => <Icon glyph="📌" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color }) => <Icon glyph="⚙︎" color={color} /> }} />
    </Tabs>
  );
}
