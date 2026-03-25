import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

function requireSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
    );
  }
  return { url, anonKey };
}

/**
 * Supabase client for Client Components (browser). Uses cookies via @supabase/ssr.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient(url, anonKey);
}

/** @deprecated Use createSupabaseBrowserClient for clarity */
export function getSupabaseBrowserClient(): SupabaseClient {
  return createSupabaseBrowserClient();
}
