# Tripwire — Project Plan

*An in-browser test runner extension.*

> Handoff document for Claude Cowork / Claude Code.
> Status: greenfield. Nothing built yet.
> Owner: Gokula Kannan (github: Developer-Geekay)

---

## 1. What this is

A Chrome/Edge MV3 extension that runs UI tests **entirely in the browser** — no Node.js, no CI runner, no headless browser, no install step beyond the extension itself.

Target script surface:

```js
await page.goto("/login");
await ui.click("#login");
await ui.type("#username", "admin");
await ui.expect("#message").toHaveText("Welcome");
await ui.expect(".error").not.toExist();
```

**Target user:** QA engineers, analysts, and devs testing *internal enterprise web apps*, where standing up Playwright/Selenium infrastructure is disproportionate to the need (smoke tests, regression checks, repeatable manual flows).

**Positioning:** "Tampermonkey ergonomics, Playwright semantics, zero toolchain."

---

## 2. Non-goals (protect these)

- **Not a CI replacement.** This is *attended automation* — browser must be open. That is a feature: no infra approval, no pipeline access needed. Say it plainly in the README.
- **Not cross-browser.** Chromium only (Chrome + Edge). CDP is the engine; that's the trade.
- **Not OutSystems-specific.** OutSystems support arrives later via an optional connector to the existing DevTools extension. Core must never import OutSystems knowledge.
- **Not AI-dependent.** AI features are strictly additive; the runner is fully usable with AI unavailable.

---

## 3. Architecture decisions (already settled — do not relitigate)

| Decision | Choice | Reason |
|---|---|---|
| Execution engine | `chrome.debugger` (CDP) | Only in-extension path to **trusted** input events, screenshots, navigation control, with zero external deps. Playwright itself speaks CDP. |
| UI home | **Side panel** (primary) + full extension tab (expanded editor/reports) | Only one debugger client can attach per tab — a DevTools panel would be blocked by its own engine. Side panel also survives page navigation and is approachable for non-devs. |
| Runner lifetime | Side panel hosts the run loop; service worker as fallback for scheduled runs | MV3 service workers die after ~30s idle. The panel is alive during a run anyway. |
| Element picker | Content script overlay (not DevTools integration) | Full control of highlight + selector suggestion tooltip. `Overlay.setInspectMode` via CDP as an alternative. |
| Editor | Monaco + `.d.ts` for the `ui`/`page` API | IntelliSense nearly free. |
| Storage | IndexedDB (scripts, runs, screenshots) + JSON export/import | Git-ability matters to the audience. |
| Auto-waiting | Built into **every** action and assertion primitive from day one | This is the single thing separating Playwright-feel from Selenium-pain. Non-negotiable. |
| OutSystems | Separate extension, joined later via `onMessageExternal` connector | Keeps runner general-purpose; OutSystems becomes a plugin, not a constraint. |

### Why not the new browser "MCP" features (asked and answered)

- **WebMCP (`navigator.modelContext`)** — a protocol for *pages* to expose tools to agents. Doesn't let an extension click/type/screenshot arbitrary pages. Internal enterprise apps won't have implemented it. → Becomes an *optional selector/action provider* later, post-Chrome-Stable.
- **Chrome DevTools MCP / Edge MCP server** — Puppeteer + Node.js over CDP, run via `npx`. That's the exact toolchain friction this product removes. → Not an engine. Possible *inverse* play later: expose the runner itself as an MCP server so Claude Code can trigger tests.

**Verdict: CDP stays the engine.**

---

## 4. The seams (build the interfaces now, implement later)

Three extension points must exist in the core from day one, even if only the default implementation ships:

### 4.1 Selector provider

```ts
interface SelectorProvider {
  namespace: string | null;          // null = default (css/text/aria)
  canResolve(ref: string): boolean;
  resolve(ref: string, ctx: RunContext): Promise<{ selector: string } | null>;
}
```

Implementations over time:
1. **Default** — CSS / text / aria / testid. *(v1)*
2. **OutSystems connector** — `os:LoginForm.Username` → resolved via cross-extension message to the DevTools extension. *(v2)*
3. **WebMCP** — page-declared tools, callable as `ui.tool("addToCart", {...})`. *(post Chrome Stable)*
4. **AI self-heal** — fallback when a selector breaks. *(v2)*

### 4.2 Connector protocol (cross-extension)

- Transport: `chrome.runtime.connect(extensionId)` for long-lived runs; `sendMessage` for one-shots.
- **Versioned handshake first:** `{ type: "hello", apiVersion: 1 }` → response advertises `capabilities: ["selector-resolution", "widget-tree", "screen-metadata"]`.
- **Capability model, not hardcoded features.** Other domain helpers (SAP, Salesforce) could implement the same contract → it's a plugin protocol, not a bilateral deal.
- **Graceful absence:** missing extension → `sendMessage` rejects → catch once at startup, cache, hide "OutSystems mode" UI.
- Always verify `sender.id` on the provider side.
- Contract lives in a third tiny repo (`.d.ts` + JSON schema) both sides pin against.

### 4.3 AI provider

```ts
interface AiProvider {
  availability(): Promise<"available" | "downloading" | "unavailable">;
  suggestSteps(nl: string, domContext: string): Promise<Step[]>;
  healSelector(broken: string, dom: string): Promise<string | null>;
  summarizeFailure(run: RunResult): Promise<string>;
}
```

- Default impl: Chrome Prompt API (`LanguageModel`, Gemini Nano). Extensions get **stable** access; pages are stuck on origin trials. On-device → nothing leaves the machine → real enterprise selling point.
- Use `responseConstraint` JSON schema for structured output. Never regex-scrape prose.
- Handle `"downloading"` / `"unavailable"` gracefully — ~4GB model download, desktop-only, GPU-gated.
- Nano is autocomplete-class, not frontier-class: use it for transform/classify/summarize, never whole-suite reasoning. Chunk DOM aggressively.
- Optional cloud-key escape hatch for heavy tasks (v2+).
- Pin a small prompt-eval fixture set; run it each Chrome stable release (Nano drifts under auto-update).

---

## 5. Phases

### Phase 0 — Repo scaffold *(day 1)*
- MV3 manifest: `sidePanel`, `debugger`, `scripting`, `storage`, `activeTab`, `alarms`, `host_permissions`.
- Vite + React + TypeScript. Side panel entry + full-tab entry mounting the **same** app.
- Service worker skeleton.
- No feature code. Just boot.

### Phase 1 — Vertical slice *(the thesis proof — ~2 weeks)*
**Goal: type a 5-line test in the side panel, hit Run, watch it pass, break it, see a screenshot.**
- CDP wrapper: attach/detach lifecycle, `Page.navigate` + lifecycle-event waiting, `Input.dispatchMouseEvent`, `Input.insertText`, `Page.captureScreenshot`, `Runtime.evaluate`.
- Primitives: `page.goto`, `ui.click`, `ui.type`, `ui.expect(...).toHaveText/toExist/not`.
- **Auto-wait + retry loop** around every primitive (poll `Runtime.evaluate`, configurable timeout).
- Script execution sandbox + step-by-step reporting back to the panel.
- Monaco editor in the panel, `ui.d.ts` loaded for IntelliSense.
- Live log with pass/fail per step; screenshot inline on failure.
- SelectorProvider interface present, default impl only, **connector stub unused**.

> Stop here and validate. Do not build recorder/reports/scheduling before this works end-to-end.

### Phase 2 — Authoring ergonomics
- Element picker (content script overlay, hover-highlight, click-to-select, selector suggestion in tooltip).
- Selector strategy ranking: `data-testid` → `id` → `aria` → text → CSS path (last resort).
- Script library: create/rename/delete, IndexedDB, JSON export/import.
- Full-tab expanded editor.

### Phase 3 — Recorder
- Content script records clicks/inputs/navigations → emits DSL.
- Reuses Phase 2 selector ranking (recorder quality *is* selector quality — this is why Selenium IDE died).
- Post-record cleanup UI (drop noise steps, insert assertions).

### Phase 4 — Suites & reporting
- Suites (ordered scripts), run-all, per-run history.
- Data-driven tests: CSV/JSON fixtures → parameterized runs.
- Report view: pass/fail matrix, timings, screenshots, export HTML/JSON.

### Phase 5 — Scheduling
- `chrome.alarms` + service worker fallback runner.
- Explicit UX framing: "runs when the browser is open."

### Phase 6 — Connector (OutSystems)
- Implement handshake + capability exchange on both sides.
- `os:` namespace selector provider.
- Recorder enrichment: ask DevTools "what widget is this element?" → emit semantic selectors.
- Screen/module metadata into reports ("failed on screen: CustomerDetail").

### Phase 7 — AI layer
- Prompt API provider behind the `AiProvider` interface.
- NL → steps, self-healing selectors, failure summaries, assertion suggestions during recording.

### Phase 8 — MCP exposure *(differentiator, mention in README early)*
- Native-messaging bridge exposing `run_test`, `list_tests`, `get_last_report` as MCP tools so Claude Code / Cursor can drive the runner and read failures + screenshots.
- Strictly optional power feature.

---

## 6. Known hard parts (don't be surprised)

- **MV3 service worker death** during long runs → keep the run loop in the side panel; offscreen document if a headless orchestrator is ever needed.
- **The yellow "is being debugged" banner** — unavoidable with CDP. Document it up front; enterprise users will ask.
- **DevTools conflict** — if the user has DevTools open on the target tab, attach fails. Detect and show a clear message.
- **iframes** — `Target.attachToTarget`; fiddly but solved.
- **Uploads/downloads** — `DOM.setFileInputFiles`, `Page.setDownloadBehavior`. Each is a mini-project; defer past Phase 4.
- **Trusted events** — the whole reason for CDP over `dispatchEvent`. Never regress to synthetic events for convenience.

---

## 7. Prior art to study before Phase 1

- **Playwright** — auto-wait semantics, `expect` API shape, codegen selector strategy. Copy the ergonomics shamelessly.
- **Chrome DevTools Recorder panel** — its existence validates demand; its limits define the gap. Study its selector logic.
- **Selenium IDE** — study *why it failed*: no auto-wait, brittle selectors. Those are precisely the two things fixed here.
- **Cypress** — in-browser runner philosophy; its iframe pain is instructive.

---

## 8. Repo layout (proposed)

```
runner-extension/          # this repo — generic, no OutSystems code
  src/
    panel/                 # React + Monaco (side panel + full tab share this)
    background/            # service worker: scheduling, lifecycle
    content/               # element picker overlay, fast DOM queries
    engine/
      cdp/                 # attach, input, screenshot, navigation
      primitives/          # click, type, goto, expect (+ auto-wait)
      providers/
        selector/          # default | connector | webmcp | ai
        ai/                # prompt-api impl behind AiProvider
    types/ui.d.ts          # the IntelliSense contract
  manifest.json

connector-protocol/        # tiny: .d.ts + JSON schema, versioned, pinned by both sides
outsystems-devtools/       # existing repo — connector provider added in Phase 6
```

Naming: keep the runner **generic** (consoleapi.in / terminal-aesthetic family). Nothing in the name should say OutSystems.

---

## 9. Definition of done for Phase 1

- [ ] Side panel opens from toolbar icon, survives page navigation.
- [ ] Monaco editor with working IntelliSense on `ui` / `page`.
- [ ] Run button attaches CDP, executes the 5-line sample test against a real page.
- [ ] Clicks are **trusted** (verify: a framework that rejects `isTrusted: false` still responds).
- [ ] `ui.expect` auto-waits and retries until timeout, then fails cleanly.
- [ ] Failure captures a screenshot and renders it inline in the panel log.
- [ ] Detach on run end / panel close / tab close — no leaked debugger sessions.
- [ ] Zero OutSystems references anywhere in the codebase.

---

## 10. First instruction for the coding agent

> Start at Phase 0, then Phase 1 only. Build the SelectorProvider and AiProvider **interfaces** with default/no-op implementations — do not implement the connector, WebMCP, or AI providers yet. Do not build the recorder, reports, or scheduling. Ship the vertical slice, then stop for review.
