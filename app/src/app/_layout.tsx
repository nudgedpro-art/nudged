import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { SessionProvider } from "../lib/session";
import { C } from "../lib/theme";

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: C.board }, headerTintColor: C.ink, headerShadowVisible: false, contentStyle: { backgroundColor: C.board } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="note/[id]" options={{ title: "" }} />
      </Stack>
    </SessionProvider>
  );
}
