import { CdpSession } from "./cdp/session";
import { Primitives } from "./primitives";
import { DefaultSelectorProvider } from "./providers/selector/default";
import { SelectorRegistry } from "./providers/selector/types";
import {
  commandLabel,
  type Command,
  type ResultMessage,
  type RunMessage,
  type SandboxToHost,
} from "../shared/protocol";

export type StepStatus = "running" | "passed" | "failed";

export interface StepRecord {
  id: number;
  label: string;
  status: StepStatus;
  durationMs?: number;
  error?: string;
  screenshot?: string; // data: URI, rendered inline in the log
}

export type RunState = "idle" | "starting" | "running" | "passed" | "failed" | "stopped";

export interface RunnerEvents {
  onStep(step: StepRecord): void; // fired on create and on every update (same id)
  onState(state: RunState, message?: string): void;
}

function isAutomatable(tab: chrome.tabs.Tab): boolean {
  return tab.id !== undefined && !!tab.url && /^(https?|file):/.test(tab.url);
}

// The panel can't automate itself or other extension pages, so pick the
// active page tab: current window first (side panel case), then the last
// focused window (full-tab editor case).
async function findTargetTab(): Promise<chrome.tabs.Tab> {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current && isAutomatable(current)) return current;
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && isAutomatable(focused)) return focused;
  const anyActive = (await chrome.tabs.query({ active: true })).filter(isAutomatable);
  if (anyActive.length > 0) return anyActive[0];
  throw new Error(
    "No page to test against. Open the app you want to test in a normal tab, then run again.",
  );
}

// Hosts the run loop: sends the user script to the sandbox page, executes the
// commands the sandbox calls back with via CDP, and reports per-step results.
export class TestRunner {
  private session: CdpSession | null = null;
  private primitives: Primitives | null = null;
  private runId: string | null = null;
  private stepSeq = 0;
  private finishRun: ((state: RunState, message?: string) => void) | null = null;

  constructor(
    private sandboxWindow: () => Window | null,
    private events: RunnerEvents,
  ) {}

  get running(): boolean {
    return this.runId !== null;
  }

  async run(code: string): Promise<void> {
    if (this.running) throw new Error("A run is already in progress");
    this.stepSeq = 0;
    this.events.onState("starting");

    const tab = await findTargetTab();
    const session = new CdpSession(tab.id!);
    this.session = session;
    try {
      await session.attach();
    } catch (err) {
      this.session = null;
      this.events.onState("failed", err instanceof Error ? err.message : String(err));
      return;
    }

    const runId = crypto.randomUUID();
    this.runId = runId;
    this.primitives = new Primitives(session, new SelectorRegistry([new DefaultSelectorProvider()]));

    const done = new Promise<void>((resolve) => {
      this.finishRun = (state, message) => {
        if (this.runId !== runId) return;
        this.runId = null;
        this.finishRun = null;
        this.events.onState(state, message);
        resolve();
      };
    });

    session.onDetached((reason) => {
      this.finishRun?.(
        "failed",
        `Debugger detached (${reason}). The tab was closed or DevTools took over.`,
      );
    });

    const sandbox = this.sandboxWindow();
    if (!sandbox) {
      await session.detach();
      this.session = null;
      this.runId = null;
      this.finishRun = null;
      this.events.onState("failed", "Script sandbox is not ready");
      return;
    }

    this.events.onState("running");
    const message: RunMessage = { type: "tripwire:run", runId, code };
    sandbox.postMessage(message, "*");

    await done;
    await session.detach();
    this.session = null;
    this.primitives = null;
  }

  stop(): void {
    if (!this.running) return;
    // Detaching makes every in-flight CDP call reject, which fails the current
    // step and unwinds the sandbox script on its next await.
    void this.session?.detach();
    this.finishRun?.("stopped", "Run stopped");
  }

  async dispose(): Promise<void> {
    this.finishRun?.("stopped", "Panel closed");
    await this.session?.detach();
    this.session = null;
  }

  /** Wire this to window "message" events; filters and routes sandbox traffic. */
  handleMessage = (event: MessageEvent): void => {
    const msg = event.data as SandboxToHost | undefined;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "tripwire:call") {
      if (msg.runId !== this.runId) {
        this.reply(event.source as Window | null, {
          type: "tripwire:result",
          callId: msg.callId,
          ok: false,
          error: "Run was stopped",
        });
        return;
      }
      void this.executeCall(event.source as Window | null, msg.callId, msg.command);
      return;
    }
    if (msg.type === "tripwire:done") {
      if (msg.runId !== this.runId) return;
      if (msg.ok) this.finishRun?.("passed");
      else this.finishRun?.("failed", msg.error ?? "Script failed");
    }
  };

  private async executeCall(source: Window | null, callId: number, command: Command): Promise<void> {
    const primitives = this.primitives;
    if (!primitives) {
      this.reply(source, { type: "tripwire:result", callId, ok: false, error: "No active run" });
      return;
    }

    if (command.kind === "setDefaultTimeout") {
      primitives.setDefaultTimeout(command.ms);
      this.reply(source, { type: "tripwire:result", callId, ok: true });
      return;
    }

    const step: StepRecord = {
      id: ++this.stepSeq,
      label: commandLabel(command),
      status: "running",
    };
    this.events.onStep({ ...step });
    const startedAt = performance.now();

    try {
      switch (command.kind) {
        case "goto":
          await primitives.goto(command.url);
          break;
        case "click":
          await primitives.click(command.target);
          break;
        case "type":
          await primitives.type(command.target, command.text);
          break;
        case "expect":
          await primitives.expect(
            command.target,
            command.assertion,
            command.expected,
            command.negated,
          );
          break;
      }
      step.status = "passed";
      step.durationMs = Math.round(performance.now() - startedAt);
      this.events.onStep({ ...step });
      this.reply(source, { type: "tripwire:result", callId, ok: true });
    } catch (err) {
      step.status = "failed";
      step.durationMs = Math.round(performance.now() - startedAt);
      step.error = err instanceof Error ? err.message : String(err);
      try {
        step.screenshot = await primitives.screenshot();
      } catch {
        // Screenshot is best-effort; the tab may already be gone.
      }
      this.events.onStep({ ...step });
      this.reply(source, { type: "tripwire:result", callId, ok: false, error: step.error });
    }
  }

  private reply(source: Window | null, message: ResultMessage): void {
    (source ?? this.sandboxWindow())?.postMessage(message, "*");
  }
}
