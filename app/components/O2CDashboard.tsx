"use client";

import { useMemo, useState } from "react";
import type { GraphEntity } from "@/lib/graph/entities";
import { O2CGraphView } from "@/app/components/O2CGraphView";
import { O2CChat } from "@/app/components/O2CChat";

type QueryResponse = {
  sql?: string | null;
  data?: unknown[];
  explanation?: string;
  entities?: GraphEntity[];
  error?: string;
};

function formatEntityList(entities: GraphEntity[]) {
  if (!entities.length) return "No entities extracted yet.";
  return entities
    .slice(0, 6)
    .map((e) => `${e.type}:${e.id}`)
    .join(", ");
}

export function O2CDashboard() {
  const [focusEntity, setFocusEntity] = useState<GraphEntity | null>(null);
  const [highlightEntities, setHighlightEntities] = useState<GraphEntity[]>([]);

  const [lastSql, setLastSql] = useState<string | null>(null);
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const entitySummary = useMemo(
    () => formatEntityList(highlightEntities),
    [highlightEntities]
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4 md:gap-6">
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100">
          <div>
            <h2 className="text-sm font-medium text-zinc-900">Graph</h2>
            <p className="text-xs text-zinc-500">{entitySummary}</p>
          </div>
          {lastSql ? (
            <div className="text-[11px] text-zinc-500" title={lastSql}>
              SQL ready
            </div>
          ) : null}
        </div>

        <O2CGraphView
          focusEntity={focusEntity}
          highlightEntities={highlightEntities}
        />
      </div>

      <div className="w-full md:w-[420px] min-h-0 shrink-0 flex flex-col rounded-lg border border-zinc-200 bg-white overflow-hidden">
        <O2CChat
          onResult={(resp: QueryResponse & { entities?: GraphEntity[] }) => {
            setLastError(null);

            if (resp && typeof resp.error === "string" && resp.error) {
              setLastError(resp.error);
              setLastSql(null);
              setLastExplanation(null);
              setHighlightEntities([]);
              setFocusEntity(null);
              return;
            }

            const entities = Array.isArray(resp.entities) ? resp.entities : [];
            setHighlightEntities(entities);
            setFocusEntity(entities[0] ?? null);
            setLastSql(typeof resp.sql === "string" ? resp.sql : null);
            setLastExplanation(
              typeof resp.explanation === "string" ? resp.explanation : null
            );
          }}
        />

        <div className="shrink-0 border-t border-zinc-100 bg-zinc-50/50 px-4 py-3">
          {lastError ? (
            <p className="text-xs text-red-600">Error: {lastError}</p>
          ) : lastSql ? (
            <div className="space-y-2">
              {lastExplanation ? (
                <p className="text-xs text-zinc-600">{lastExplanation}</p>
              ) : null}
              <details className="text-xs">
                <summary className="cursor-pointer text-zinc-600">
                  View SQL
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white border border-zinc-200 p-2 text-[11px] text-zinc-900">
                  {lastSql}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              Ask a question to generate a graph.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

