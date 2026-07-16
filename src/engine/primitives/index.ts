import { CdpError, CdpSession } from "../cdp/session";
import { SelectorRegistry } from "../providers/selector/types";
import { tripwireProbe, type ProbePoint, type ProbeState } from "./inpage";

export class TimeoutError extends Error {}
export class AssertionError extends Error {}

export interface RunOptions {
  defaultTimeoutMs: number;
  navigationTimeoutMs: number;
  pollIntervalMs: number;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  defaultTimeoutMs: 10_000,
  navigationTimeoutMs: 30_000,
  pollIntervalMs: 100,
};

const PROBE_SOURCE = tripwireProbe.toString();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Attempt<T> = { done: true; value: T } | { done: false; detail?: string };

// Every action and assertion goes through this retry loop — auto-waiting is
// built into the primitives themselves, never bolted on by callers.
export class Primitives {
  readonly options: RunOptions;

  constructor(
    private session: CdpSession,
    private selectors: SelectorRegistry,
    options: Partial<RunOptions> = {},
  ) {
    this.options = { ...DEFAULT_RUN_OPTIONS, ...options };
  }

  setDefaultTimeout(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.options.defaultTimeoutMs = ms;
  }

  async goto(url: string): Promise<void> {
    const target = await this.resolveUrl(url);
    const loaded = this.session.waitForEvent(
      "Page.loadEventFired",
      this.options.navigationTimeoutMs,
    );
    loaded.catch(() => {}); // surfaced via the await below, not as an unhandled rejection
    const nav = await this.session.send<{ errorText?: string }>("Page.navigate", {
      url: target,
    });
    if (nav.errorText) {
      throw new Error(`Navigation to ${target} failed: ${nav.errorText}`);
    }
    await loaded;
  }

  async click(ref: string): Promise<void> {
    const descriptor = await this.resolve(ref);
    await this.retry(this.options.defaultTimeoutMs, `waiting to click ${ref}`, async () => {
      const state = await this.probeState(descriptor);
      if (!state.found) return { done: false, detail: "element not found" };
      if (!state.visible) return { done: false, detail: "element not visible" };
      const point = await this.probe<ProbePoint | null>(descriptor, "point");
      if (!point) return { done: false, detail: "element has no clickable area" };
      await this.dispatchClick(point);
      return { done: true, value: undefined };
    });
  }

  async type(ref: string, text: string): Promise<void> {
    const descriptor = await this.resolve(ref);
    await this.retry(this.options.defaultTimeoutMs, `waiting to type into ${ref}`, async () => {
      const state = await this.probeState(descriptor);
      if (!state.found) return { done: false, detail: "element not found" };
      if (!state.visible) return { done: false, detail: "element not visible" };
      const point = await this.probe<ProbePoint | null>(descriptor, "point");
      if (!point) return { done: false, detail: "element has no clickable area" };
      await this.dispatchClick(point);
      // Select any existing content so insertText replaces instead of appends.
      await this.probe<boolean>(descriptor, "focus");
      await this.session.send("Input.insertText", { text });
      return { done: true, value: undefined };
    });
  }

  async expect(
    ref: string,
    assertion: "toHaveText" | "toExist",
    expected: string | undefined,
    negated: boolean,
  ): Promise<void> {
    const descriptor = await this.resolve(ref);
    const describe =
      `expect(${ref})${negated ? ".not" : ""}.${assertion}` +
      (expected !== undefined ? `(${JSON.stringify(expected)})` : "()");
    try {
      await this.retry(this.options.defaultTimeoutMs, describe, async () => {
        const state = await this.probeState(descriptor);
        let condition: boolean;
        let detail: string;
        if (assertion === "toExist") {
          condition = state.found;
          detail = state.found ? "element exists" : "element not found";
        } else {
          const normalizedExpected = (expected ?? "").replace(/\s+/g, " ").trim();
          condition = state.found && state.text === normalizedExpected;
          detail = state.found
            ? `text was ${JSON.stringify(state.text)}`
            : "element not found";
        }
        const pass = negated ? !condition : condition;
        return pass ? { done: true, value: undefined } : { done: false, detail };
      });
    } catch (err) {
      if (err instanceof TimeoutError) throw new AssertionError(err.message);
      throw err;
    }
  }

  async screenshot(): Promise<string> {
    const { data } = await this.session.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
    });
    return `data:image/png;base64,${data}`;
  }

  private async retry<T>(
    timeoutMs: number,
    describe: string,
    attempt: () => Promise<Attempt<T>>,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastDetail: string | undefined;
    for (;;) {
      const result = await attempt();
      if (result.done) return result.value;
      lastDetail = result.detail ?? lastDetail;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `Timed out after ${timeoutMs}ms: ${describe}` +
            (lastDetail ? ` (${lastDetail})` : ""),
        );
      }
      await sleep(this.options.pollIntervalMs);
    }
  }

  private async resolve(ref: string): Promise<string> {
    const resolved = await this.selectors.resolve(ref, { tabId: this.session.tabId });
    if (!resolved) throw new Error(`No selector provider could resolve ${JSON.stringify(ref)}`);
    return resolved.selector;
  }

  private probeState(descriptor: string): Promise<ProbeState> {
    return this.probe<ProbeState>(descriptor, "state");
  }

  private async probe<T>(descriptor: string, action: "state" | "point" | "focus"): Promise<T> {
    const expression = `(${PROBE_SOURCE})(${JSON.stringify(descriptor)}, ${JSON.stringify(action)})`;
    const result = await this.session.send<{
      result: { value?: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) {
      throw new CdpError(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    }
    return result.result.value as T;
  }

  private async dispatchClick(point: ProbePoint): Promise<void> {
    // CDP input events are the whole reason this engine exists: they are
    // trusted (isTrusted: true), unlike anything dispatchEvent can produce.
    const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
    await this.session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await this.session.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await this.session.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
  }

  private async resolveUrl(url: string): Promise<string> {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    const tab = await chrome.tabs.get(this.session.tabId);
    const base = tab.url && /^(https?|file):/.test(tab.url) ? tab.url : undefined;
    if (!base) {
      throw new Error(
        `Relative URL ${JSON.stringify(url)} requires the target tab to already be on a page; ` +
          "use an absolute URL for the first goto",
      );
    }
    return new URL(url, base).toString();
  }
}
