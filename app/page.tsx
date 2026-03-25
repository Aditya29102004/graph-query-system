import { Suspense } from "react";
import { SupabaseStatus } from "@/app/components/SupabaseStatus";
import { O2CDashboard } from "@/app/components/O2CDashboard";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-zinc-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Graph query
        </h1>
        <Suspense fallback={<p className="text-xs text-zinc-400">Checking Supabase…</p>}>
          <SupabaseStatus />
        </Suspense>
      </header>

      <main className="flex min-h-0 flex-1 p-4 md:p-6">
        <O2CDashboard />
      </main>
    </div>
  );
}

