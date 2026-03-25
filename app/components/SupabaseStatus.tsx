import { checkSupabaseConnectivity } from "@/app/lib/supabase/connectivity";

export async function SupabaseStatus() {
  const result = await checkSupabaseConnectivity();

  if (!result.ok && result.reason === "missing_env") {
    return (
      <p className="text-xs text-amber-700">
        Set Supabase URL and anon key in{" "}
        <code className="rounded bg-amber-100 px-1">.env.local</code>
      </p>
    );
  }

  if (!result.ok) {
    return (
      <p className="text-xs text-red-600" title={result.detail}>
        Supabase unreachable
        {result.detail ? ` (${result.detail})` : null}
      </p>
    );
  }

  return <p className="text-xs text-emerald-700">Supabase connected</p>;
}
