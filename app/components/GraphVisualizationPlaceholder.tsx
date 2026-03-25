export function GraphVisualizationPlaceholder() {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-dashed border-zinc-300 bg-white p-6 shadow-sm"
      aria-label="Graph visualization placeholder"
    >
      <header className="mb-4 shrink-0">
        <h2 className="text-sm font-medium text-zinc-800">Graph</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Visualization will render here.
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center rounded-md bg-zinc-50/80">
        <span className="text-sm text-zinc-400">No graph data</span>
      </div>
    </section>
  );
}
