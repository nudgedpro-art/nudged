import type { Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { FUNCTIONS_URL, supabase } from "./supabase";

interface Ctx {
  session: Session | null;
  loading: boolean;
  connectGoogle: () => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Ctx>({ session: null, loading: true, connectGoogle: async () => ({ ok: false }), signOut: async () => {} });

/** Turn the magic-link hand-off (nudged://auth#token_hash=…) into a session. */
async function consumeAuthUrl(url: string): Promise<string | null> {
  const hash = url.split("#")[1] ?? "";
  const params = new URLSearchParams(hash);
  const tokenHash = params.get("token_hash");
  if (!tokenHash) return "No sign-in token in the link";
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  return error ? error.message : null;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    // Cold-start or background deep link (Android, or iOS when the browser sheet was dismissed by the system).
    const onUrl = ({ url }: { url: string }) => { if (url.includes("token_hash=")) consumeAuthUrl(url); };
    Linking.getInitialURL().then((u) => { if (u) onUrl({ url: u }); });
    const l = Linking.addEventListener("url", onUrl);
    return () => { sub.subscription.unsubscribe(); l.remove(); };
  }, []);

  const connectGoogle = useCallback(async () => {
    const redirect = Linking.createURL("auth");  // nudged://auth
    const start = `${FUNCTIONS_URL}/google-auth/start?ret=app`;
    const res = await WebBrowser.openAuthSessionAsync(start, redirect, { preferEphemeralSession: false });
    if (res.type !== "success") return { ok: false, error: res.type === "cancel" || res.type === "dismiss" ? "Sign-in was cancelled" : "Sign-in did not complete" };
    const err = await consumeAuthUrl(res.url);
    return err ? { ok: false, error: err } : { ok: true };
  }, []);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const value = useMemo(() => ({ session, loading, connectGoogle, signOut }), [session, loading, connectGoogle, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
