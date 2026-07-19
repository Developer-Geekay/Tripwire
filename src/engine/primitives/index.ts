import { CdpError, CdpSession } from "../cdp/session";
import { SelectorRegistry } from "../providers/selector/types";
import type { ExpectAssertion } from "../../shared/protocol";
import { tripwireProbe, type ProbePoint, type ProbeState } from "./inpage";

export class TimeoutError extends Error {}
export class AssertionError extends Error {}

export interface RunOptions {
  defaultTimeoutMs: number;
  navigationTimeoutMs: number;
  pollIntervalMs: number;
  /** Delay applied before every action/assertion (0 = off). */
  slowMoMs: number;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  defaultTimeoutMs: 10_000,
  navigationTimeoutMs: 30_000,
  pollIntervalMs: 100,
  slowMoMs: 0,
};

const MAX_WAIT_MS = 600_000;

const PROBE_SOURCE = tripwireProbe.toString();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NOT_FOUND_DETAIL =
  "element not found — check the selector; note that elements inside iframes are not reachable yet";

type Attempt<T> = { done: true; value: T } | { done: false; detail?: string };

interface KeyDef {
  key: string;
  code: string;
  vk: number;
  text?: string;
}

// Named keys usable with ui.press() and internally (clear, newline typing).
const NAMED_KEYS: Record<string, KeyDef> = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
};

function charKeyDef(ch: string): KeyDef {
  if (/^[a-zA-Z]$/.test(ch)) {
    return { key: ch, code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0), text: ch };
  }
  if (/^[0-9]$/.test(ch)) {
    return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0), text: ch };
  }
  if (ch === " ") {
    return { key: " ", code: "Space", vk: 32, text: " " };
  }
  // Punctuation/unicode: no reliable physical key mapping, but a keyDown with
  // text still fires trusted keydown/beforeinput/input and inserts the char.
  return { key: ch, code: "", vk: 0, text: ch };
}

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

  setSlowMo(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.options.slowMoMs = Math.min(ms, MAX_WAIT_MS);
  }

  /** Explicit pause between steps (capped at 10 minutes). */
  async wait(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`Invalid wait duration: ${ms}`);
    await sleep(Math.min(ms, MAX_WAIT_MS));
  }

  /** Applied by the runner before each action when slowMo is set. */
  async applySlowMo(): Promise<void> {
    if (this.options.slowMoMs > 0) await sleep(this.options.slowMoMs);
  }

  async goto(url: string, spa = false): Promise<void> {
    const target = await this.resolveUrl(url);
    if (spa) {
      // SPA-router navigation: push the URL and fire popstate so client-side
      // routers (React Router, Angular, Vue Router) pick it up — the page is
      // NOT reloaded, so app state survives. Same-origin only by nature.
      await this.evaluate(
        `(function (u) {
          history.pushState(history.state, "", u);
          window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
          if (u.indexOf("#") !== -1) {
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          }
          return location.href;
        })(${JSON.stringify(target)})`,
      );
      return;
    }
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
      const ready = await this.readyForAction(descriptor);
      if (!ready.ok) return { done: false, detail: ready.detail };
      await this.dispatchClick(ready.point);
      return { done: true, value: undefined };
    });
  }

  /**
   * Click to focus, clear existing content, then type with real trusted
   * keyboard events (keydown/keyup + input per char) so frameworks bound to
   * keyboard or input events (React/Angular/Vue) see exactly what a user
   * typing produces.
   */
  async type(ref: string, text: string): Promise<void> {
    const descriptor = await this.resolve(ref);
    await this.retry(this.options.defaultTimeoutMs, `waiting to type into ${ref}`, async () => {
      const ready = await this.readyForAction(descriptor);
      if (!ready.ok) return { done: false, detail: ready.detail };
      await this.dispatchClick(ready.point);
      await this.clearFocused(descriptor);
      await this.typeText(text);
      return { done: true, value: undefined };
    });
  }

  /**
   * Set the whole value in one shot: focus, select-all, then a single trusted
   * insertText. Fires one input event (no per-key keydown/keyup) — use when
   * simulated keystrokes are unnecessary or undesirable; use type() when the
   * app listens to keyboard events.
   */
  async fill(ref: string, text: string): Promise<void> {
    const descriptor = await this.resolve(ref);
    await this.retry(this.options.defaultTimeoutMs, `waiting to fill ${ref}`, async () => {
      const ready = await this.readyForAction(descriptor);
      if (!ready.ok) return { done: false, detail: ready.detail };
      await this.dispatchClick(ready.point);
      await this.probe<boolean>(descriptor, "focus");
      await this.session.send("Input.insertText", { text });
      return { done: true, value: undefined };
    });
  }

  /** Focus the element and delete its content via a trusted Backspace. */
  async clear(ref: string): Promise<void> {
    const descriptor = await this.resolve(ref);
    await this.retry(this.options.defaultTimeoutMs, `waiting to clear ${ref}`, async () => {
      const ready = await this.readyForAction(descriptor);
      if (!ready.ok) return { done: false, detail: ready.detail };
      await this.dispatchClick(ready.point);
      await this.clearFocused(descriptor);
      return { done: true, value: undefined };
    });
  }

  /** Press a key on whatever currently has focus (e.g. after ui.type). */
  async press(key: string): Promise<void> {
    const def = NAMED_KEYS[key] ?? (key.length === 1 ? charKeyDef(key) : null);
    if (!def) {
      throw new Error(
        `Unknown key ${JSON.stringify(key)}. Use a single character or one of: ` +
          Object.keys(NAMED_KEYS).join(", "),
      );
    }
    await this.dispatchKey(def);
  }

  async expect(
    ref: string,
    assertion: ExpectAssertion,
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
        const normExpected = (expected ?? "").replace(/\s+/g, " ").trim();
        let condition: boolean;
        let detail: string;
        if (assertion === "toExist") {
          condition = state.found;
          detail = state.found ? "element exists" : NOT_FOUND_DETAIL;
        } else if (assertion === "toHaveValue") {
          condition = state.found && state.value !== null && state.value.trim() === (expected ?? "").trim();
          detail = !state.found
            ? NOT_FOUND_DETAIL
            : state.value === null
              ? "element is not an input/textarea/select"
              : `value was ${JSON.stringify(state.value)}`;
        } else if (assertion === "toContainText") {
          condition = state.found && (state.text ?? "").includes(normExpected);
          detail = state.found ? `text was ${JSON.stringify(state.text)}` : NOT_FOUND_DETAIL;
        } else {
          condition = state.found && state.text === normExpected;
          detail = !state.found
            ? NOT_FOUND_DETAIL
            : `text was ${JSON.stringify(state.text)}` +
              ((state.text ?? "").includes(normExpected) && state.text !== normExpected
                ? " — it contains the expected text; toHaveText is an exact match, use toContainText for partial matches"
                : "");
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

  private async readyForAction(
    descriptor: string,
  ): Promise<{ ok: true; point: ProbePoint } | { ok: false; detail: string }> {
    const state = await this.probeState(descriptor);
    if (!state.found) return { ok: false, detail: NOT_FOUND_DETAIL };
    if (!state.visible) return { ok: false, detail: "element not visible" };
    const point = await this.probe<ProbePoint | null>(descriptor, "point");
    if (!point) return { ok: false, detail: "element has no clickable area" };
    return { ok: true, point };
  }

  // Select-all (via the focus probe) then Backspace, so frameworks receive a
  // trusted keydown + beforeinput + input for the deletion.
  private async clearFocused(descriptor: string): Promise<void> {
    await this.probe<boolean>(descriptor, "focus");
    const state = await this.probeState(descriptor);
    if ((state.value ?? state.text ?? "") !== "") {
      await this.dispatchKey(NAMED_KEYS.Backspace);
    }
  }

  private async typeText(text: string): Promise<void> {
    for (const ch of text) {
      await this.dispatchKey(ch === "\n" ? NAMED_KEYS.Enter : charKeyDef(ch));
    }
  }

  private async dispatchKey(def: KeyDef): Promise<void> {
    const base = {
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      nativeVirtualKeyCode: def.vk,
    };
    await this.session.send("Input.dispatchKeyEvent", {
      ...base,
      type: "keyDown",
      ...(def.text !== undefined ? { text: def.text, unmodifiedText: def.text } : {}),
    });
    await this.session.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
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
    return this.evaluate<T>(
      `(${PROBE_SOURCE})(${JSON.stringify(descriptor)}, ${JSON.stringify(action)})`,
    );
  }

  private async evaluate<T>(expression: string): Promise<T> {
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
