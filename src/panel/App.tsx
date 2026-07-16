export function App({ surface }: { surface: "panel" | "tab" }) {
  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">tripwire</span>
        <span className="app-surface">{surface}</span>
      </header>
      <main className="app-body">
        <p className="placeholder">Phase 0 boot — feature code arrives in Phase 1.</p>
      </main>
    </div>
  );
}
