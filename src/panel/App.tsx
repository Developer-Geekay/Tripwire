import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { editor as monacoEditor } from "monaco-editor";
import { findTargetTab, TestRunner, type RunState, type StepRecord } from "../engine/runner";
import {
  createScript,
  deleteScript,
  exportScripts,
  listScripts,
  parseImport,
  putScript,
  uniqueName,
  type ScriptRecord,
} from "./db";
import { Docs } from "./Docs";
import { Editor } from "./Editor";
import { Library } from "./Library";
import { RunLog } from "./RunLog";

const LEGACY_SCRIPT_KEY = "tripwire:script";
const CURRENT_ID_KEY = "tripwire:currentScriptId";

const SAMPLE_SCRIPT = `// Tripwire runs this against your active tab.
// Selectors: CSS by default, or "text=", "testid=", "aria=" prefixes.
// Use the "pick" button to grab a selector from the page.

await page.goto("https://example.com/");
await ui.expect("h1").toHaveText("Example Domain");
await ui.expect(".error").not.toExist();
await ui.click("text=More information...");
`;

const NEW_TEMPLATE = `// New Tripwire script. \`page\` and \`ui\` are in scope; top-level await works.

await page.goto("https://");
`;

export function App({ surface }: { surface: "panel" | "tab" }) {
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runMessage, setRunMessage] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const sandboxRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);

  const current = scripts.find((s) => s.id === currentId);

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

  // Element picker results arrive over chrome.runtime from the content script.
  useEffect(() => {
    const listener = (msg: { type?: string; ref?: string }) => {
      if (msg?.type === "tripwire:picked" && typeof msg.ref === "string") {
        setPicking(false);
        setNotice(`picked ${msg.ref}`);
        const editor = editorRef.current;
        if (editor) {
          const selection = editor.getSelection();
          if (selection) {
            editor.executeEdits("tripwire-picker", [
              { range: selection, text: JSON.stringify(msg.ref), forceMoveMarkers: true },
            ]);
          }
        }
      } else if (msg?.type === "tripwire:pick-cancelled") {
        setPicking(false);
        setNotice(null);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Load the library; migrate the Phase 1 single-script storage on first run.
  useEffect(() => {
    void (async () => {
      let list = await listScripts();
      if (list.length === 0) {
        const stored = await chrome.storage.local.get(LEGACY_SCRIPT_KEY);
        const legacy = stored[LEGACY_SCRIPT_KEY];
        const first =
          typeof legacy === "string" && legacy.trim()
            ? createScript("untitled", legacy)
            : createScript("sample", SAMPLE_SCRIPT);
        await putScript(first);
        await chrome.storage.local.remove(LEGACY_SCRIPT_KEY);
        list = [first];
      }
      const stored = await chrome.storage.local.get(CURRENT_ID_KEY);
      const savedId = stored[CURRENT_ID_KEY];
      const selected = list.find((s) => s.id === savedId) ?? list[0];
      setScripts(list);
      setCurrentId(selected.id);
      setLibraryReady(true);
    })();
  }, []);

  useEffect(() => {
    if (currentId) void chrome.storage.local.set({ [CURRENT_ID_KEY]: currentId });
  }, [currentId]);

  // Persist the current script, debounced.
  useEffect(() => {
    if (!libraryReady || !current) return;
    const timer = setTimeout(() => {
      void putScript({ ...current, updatedAt: Date.now() });
    }, 400);
    return () => clearTimeout(timer);
  }, [libraryReady, current]);

  const busy = runState === "starting" || runState === "running";

  const updateCurrent = useCallback(
    (patch: Partial<ScriptRecord>) => {
      setScripts((prev) => prev.map((s) => (s.id === currentId ? { ...s, ...patch } : s)));
    },
    [currentId],
  );

  const handleRun = useCallback(() => {
    if (!current) return;
    setSteps([]);
    setRunMessage(undefined);
    setNotice(null);
    void runner.run(current.code);
  }, [runner, current]);

  const handlePick = useCallback(async () => {
    try {
      const tab = await findTargetTab();
      setPicking(true);
      setNotice("pick an element on the page (Esc cancels)");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ["picker.js"],
      });
      await chrome.tabs.update(tab.id!, { active: true });
    } catch (err) {
      setPicking(false);
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleCreate = useCallback(() => {
    const record = createScript(
      uniqueName("untitled", scripts.map((s) => s.name)),
      NEW_TEMPLATE,
    );
    void putScript(record);
    setScripts((prev) => [...prev, record].sort((a, b) => a.name.localeCompare(b.name)));
    setCurrentId(record.id);
  }, [scripts]);

  const handleRename = useCallback(
    (name: string) => {
      const others = scripts.filter((s) => s.id !== currentId).map((s) => s.name);
      updateCurrent({ name: uniqueName(name, others) });
    },
    [scripts, currentId, updateCurrent],
  );

  const handleDelete = useCallback(() => {
    if (!currentId) return;
    void deleteScript(currentId);
    const remaining = scripts.filter((s) => s.id !== currentId);
    if (remaining.length === 0) {
      const fresh = createScript("sample", SAMPLE_SCRIPT);
      void putScript(fresh);
      setScripts([fresh]);
      setCurrentId(fresh.id);
    } else {
      setScripts(remaining);
      setCurrentId(remaining[0].id);
    }
  }, [currentId, scripts]);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(exportScripts(scripts), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tripwire-scripts.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [scripts]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const imported = parseImport(await file.text());
        const names = new Set(scripts.map((s) => s.name));
        const records = imported.map((s) => {
          const record = createScript(uniqueName(s.name, names), s.code);
          names.add(record.name);
          return record;
        });
        await Promise.all(records.map(putScript));
        setScripts((prev) =>
          [...prev, ...records].sort((a, b) => a.name.localeCompare(b.name)),
        );
        if (records.length > 0) setCurrentId(records[0].id);
        setNotice(`imported ${records.length} script${records.length === 1 ? "" : "s"}`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [scripts],
  );

  const openFullTab = useCallback(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("tab.html") });
  }, []);

  const insertSnippet = useCallback((code: string) => {
    setShowDocs(false);
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    if (selection) {
      editor.executeEdits("tripwire-docs", [
        { range: selection, text: code, forceMoveMarkers: true },
      ]);
    }
    editor.focus();
  }, []);

  return (
    <div className={`app ${surface === "tab" ? "app-tab" : ""}`}>
      <header className="app-header">
        <span className="app-title">tripwire</span>
        <span className={`run-state run-state-${runState}`}>{runState}</span>
        <span className="header-spacer" />
        <button
          className={`btn ${showDocs ? "btn-primary" : ""}`}
          onClick={() => setShowDocs((v) => !v)}
          title="Usage guide: API, selectors, troubleshooting"
        >
          docs
        </button>
        <button
          className="btn"
          onClick={handlePick}
          disabled={busy || picking}
          title="Pick an element from the page and insert its selector"
        >
          {picking ? "picking…" : "pick"}
        </button>
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
          <button className="btn btn-primary" onClick={handleRun} disabled={!current}>
            run
          </button>
        )}
      </header>
      <Library
        scripts={scripts}
        currentId={currentId}
        disabled={busy}
        onSelect={setCurrentId}
        onCreate={handleCreate}
        onRename={handleRename}
        onDelete={handleDelete}
        onExport={handleExport}
        onImport={(file) => void handleImport(file)}
      />
      {notice && <div className="notice">{notice}</div>}
      <main className="app-body" style={showDocs ? { display: "none" } : undefined}>
        <section className="editor-pane">
          <Editor
            value={current?.code ?? ""}
            onChange={(code) => updateCurrent({ code })}
            readOnly={busy || !current}
            onMount={(editor) => (editorRef.current = editor)}
          />
        </section>
        <section className="log-pane">
          <RunLog steps={steps} runState={runState} runMessage={runMessage} />
        </section>
      </main>
      {showDocs && (
        <main className="app-body docs-pane">
          <Docs onInsert={insertSnippet} />
        </main>
      )}
      <iframe
        ref={sandboxRef}
        className="sandbox-frame"
        src={chrome.runtime.getURL("sandbox.html")}
        title="Tripwire script sandbox"
      />
    </div>
  );
}
