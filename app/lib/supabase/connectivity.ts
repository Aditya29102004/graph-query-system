export type SupabaseConnectivity =
  | { ok: true }
  | { ok: false; reason: "missing_env" | "unreachable"; detail?: string };

/** Lightweight check that URL + anon key reach Supabase Auth (no DB table required). */
export async function checkSupabaseConnectivity(): Promise<SupabaseConnectivity> {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!rawUrl || !key) {
    return { ok: false, reason: "missing_env" };
  }

  const base = rawUrl.replace(/\/$/, "");

  try {
    const res = await fetch(`${base}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        ok: false,
        reason: "unreachable",
        detail: `Auth API returned ${res.status}`,
      };
    }

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "unreachable",
      detail: e instanceof Error ? e.message : "Network error",
    };
  }
}
