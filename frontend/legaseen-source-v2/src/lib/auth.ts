import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/** Browser-side session. Routes that use this must be `ssr: false`. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, ready };
}

export function displayName(session: Session | null): string {
  const meta = session?.user.user_metadata as Record<string, unknown> | undefined;
  const fromMeta = meta?.["display_name"];
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  return session?.user.email?.split("@")[0] ?? "";
}

/**
 * Which external providers this Supabase project actually has enabled.
 * Read at runtime so a provider turned on in the dashboard lights up its
 * button without a code change.
 */
export function useAuthProviders() {
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    const url = import.meta.env["VITE_SUPABASE_URL"];
    const key = import.meta.env["VITE_SUPABASE_ANON_KEY"];
    if (!url || !key) return;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProviders(d?.external ?? {}))
      .catch(() => setProviders({}));
  }, []);
  return providers;
}
