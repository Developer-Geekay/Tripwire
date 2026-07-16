import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import uiTypes from "../types/ui.d.ts?raw";

// Workers must be bundled locally: extension-page CSP (script-src 'self')
// rules out any CDN-loaded Monaco.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

const defaults = monaco.languages.typescript.javascriptDefaults;

defaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  allowNonTsExtensions: true,
  lib: ["esnext"],
});

defaults.setDiagnosticsOptions({
  // 1375/1378: top-level await — tripwire scripts are wrapped in an async
  // function at run time, so it is always legal here.
  diagnosticCodesToIgnore: [1375, 1378],
});

defaults.addExtraLib(uiTypes, "ts:tripwire/ui.d.ts");

export { monaco };
