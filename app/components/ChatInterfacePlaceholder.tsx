export function ChatInterfacePlaceholder() {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white shadow-sm"
      aria-label="Chat interface placeholder"
    >
      <header className="shrink-0 border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-800">Chat</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Ask questions about your graph.
        </p>
      </header>
      <div className="min-h-[200px] flex-1 overflow-auto p-4">
        <p className="text-sm text-zinc-400">Messages will appear here.</p>
      </div>
      <footer className="shrink-0 border-t border-zinc-100 p-3">
        <div className="flex gap-2">
          <div className="h-9 flex-1 rounded-md border border-zinc-200 bg-zinc-50" />
          <div className="h-9 w-16 shrink-0 rounded-md bg-zinc-200" />
        </div>
      </footer>
    </section>
  );
}
