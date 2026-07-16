import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TestRunner, type RunState, type StepRecord } from "../engine/runner";
import { Editor } from "./Editor";
import { RunLog } from "./RunLog";

const STORAGE_KEY = "tripwire:script";

const SAMPLE_SCRIPT = `// Tripwire runs this against your active tab.
// Selectors: CSS by default, or "text=", "testid=", "aria=" prefixes.

await page.goto("https://example.com/");
await ui.expect("h1").toHaveText("Example Domain");
await ui.expect(".error").not.toExist();
await ui.click("text=More information...");
`;

export function App({ surface }: { surface: "panel" | "tab" }) {
  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runMessage, setRunMessage] = useState<string | undefined>();
  const sandboxRef = useRef<HTMLIFrameElement>(null);

  const runner = useMemo(
    () =>
      new TestRunner(() => sandboxRef.current?.contentWindow ?? null, {
        onStep(step) {
          setSteps((prev) => {
            const index = prev.findIndex((s) => s.id === step.id);
            if (index === -1) return [...prev, step];
            const next = prev.slice();
            next[index] = step;
            return next;
          });
        },
        onState(state, message) {
          setRunState(state);
          setRunMessage(message);
        },
      }),
    [],
  );

  useEffect(() => {
    window.addEventListener("message", runner.handleMessage);
    // Detach the debugger if the panel goes away mid-run — never leak a session.
    const onPageHide = () => void runner.dispose();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("message", runner.handleMessage);
      window.removeEventListener("pagehide", onPageHide);
      void runner.dispose();
    };
  }, [runner]);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY).then((stored) => {
      const saved = stored[STORAGE_KEY];
      if (typeof saved === "string" && saved.trim()) setScript(saved);
      setScriptLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!scriptLoaded) return;
    const timer = setTimeout(() => {
      void chrome.storage.local.set({ [STORAGE_KEY]: script });
    }, 400);
    return () => clearTimeout(timer);
  }, [script, scriptLoaded]);

  const busy = runState === "starting" || runState === "running";

  const handleRun = useCallback(() => {
    setSteps([]);
    setRunMessage(undefined);
    void runner.run(script);
  }, [runner, script]);

  const openFullTab = useCallback(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("tab.html") });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">tripwire</span>
        <span className={`run-state run-state-${runState}`}>{runState}</span>
        <span className="header-spacer" />
        {surface === "panel" && (
          <button className="btn" onClick={openFullTab} title="Open the expanded editor">
            expand
          </button>
        )}
        {busy ? (
          <button className="btn btn-danger" onClick={() => runner.stop()}>
            stop
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleRun} disabled={!scriptLoaded}>
            run
          </button>
        )}
      </header>
      <main className="app-body">
        <section className="editor-pane">
          <Editor value={script} onChange={setScript} readOnly={busy} />
        </section>
        <section className="log-pane">
          <RunLog steps={steps} runState={runState} runMessage={runMessage} />
        </section>
      </main>
      <iframe
        ref={sandboxRef}
        className="sandbox-frame"
        src={chrome.runtime.getURL("sandbox.html")}
        title="Tripwire script sandbox"
      />
    </div>
  );
}
