"use client";

import { useMemo, useState } from "react";
import type { GraphEntity } from "@/lib/graph/entities";

type QueryResponse =
  | {
      sql: string;
      data: unknown[];
      explanation: string;
      entities: GraphEntity[];
    }
  | {
      error: string;
      sql: string | null;
      data: unknown[];
      explanation: string;
      entities: GraphEntity[];
    };

export function O2CChat({
  onResult,
}: {
  onResult: (resp: QueryResponse) => void;
}) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = useMemo(
    () => message.trim().length > 0 && !loading,
    [message, loading]
  );

  async function submit() {
    const q = message.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      const json = (await res.json()) as QueryResponse;

      if (!res.ok && "error" in json) setError(json.error);
      onResult(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-800">Chat</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Ask about orders, deliveries, invoices, payments, customers, products.
        </p>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-600">
            Your question
          </label>
          <textarea
            className="w-full min-h-[92px] resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Which products appear on the most invoices?"
          />

          {error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : (
            <p className="text-[11px] text-zinc-500">
              Tip: press `Ctrl+Enter` to send.
            </p>
          )}

          <button
            disabled={!canSend}
            onClick={() => void submit()}
            className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {loading ? "Asking…" : "Ask"}
          </button>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
          <p className="text-xs font-medium text-zinc-700">How it works</p>
          <p className="mt-1 text-xs text-zinc-600 leading-relaxed">
            We send your message to the server LLM, run the generated read-only
            SQL on Supabase, then visualize related entities.
          </p>
        </div>
      </div>
    </section>
  );
}

