/**
 * Tripwire script API.
 *
 * Scripts run with top-level await and two globals: `page` and `ui`.
 *
 * Selector syntax (everywhere a selector is accepted):
 *   "#login"             CSS selector (the default)
 *   "css=#login"         CSS selector, explicit
 *   "text=welcome"       case-insensitive substring match on visible text —
 *                        picks the deepest visible element containing it
 *   "text=\"Welcome\""   exact, whitespace-normalized text match
 *   "testid=submit-btn"  matches [data-testid="submit-btn"]
 *   "aria=Close dialog"  matches [aria-label="Close dialog"]
 *
 * Chain segments with ">>" to scope a search to a parent element:
 *   "#orders >> text=pending"   the text is searched only inside #orders
 *   "#form >> .row >> testid=x" each step searches within the previous match
 *
 * Selectors pierce open shadow roots, so components rendered by web-component
 * frameworks are reachable with plain CSS.
 *
 * Every action and assertion auto-waits: it retries until the element is
 * ready (or the assertion holds), then fails cleanly after the timeout.
 */

interface TripwireExpectation {
  /**
   * Assert the element's whitespace-normalized text equals `expected`.
   * For input/textarea/select elements this reads the current value (the
   * text you see on screen), not the empty textContent.
   */
  toHaveText(expected: string): Promise<void>;
  /** Assert the element's text (or field value) contains `expected`. */
  toContainText(expected: string): Promise<void>;
  /** Assert an input/textarea/select's value equals `expected` (trimmed). */
  toHaveValue(expected: string): Promise<void>;
  /** Assert a matching element is present in the DOM. */
  toExist(): Promise<void>;
  /** Invert the assertion: `ui.expect(".error").not.toExist()`. */
  readonly not: TripwireExpectation;
}

interface TripwireUi {
  /** Wait for the element to be visible, then send a trusted click. */
  click(selector: string): Promise<void>;
  /**
   * Wait for the element, click to focus, clear existing content, then type
   * `text` using real trusted keyboard events — each character fires
   * keydown/keyup and input, so React/Angular/Vue bindings update exactly as
   * they would for a human typing. "\n" in the text presses Enter.
   */
  type(selector: string, text: string): Promise<void>;
  /**
   * Set the whole value in one shot: focus, select existing content, insert
   * `text` as a single trusted input event. Faster than type() and fires no
   * per-key keydown/keyup — use it when the app only needs the value; use
   * type() when it listens to keyboard events (masks, autocomplete, hotkeys).
   */
  fill(selector: string, text: string): Promise<void>;
  /**
   * Focus the element and delete its content with a trusted select-all +
   * Backspace. Use before ui.press-driven input when you need clearing and
   * typing as separate steps.
   */
  clear(selector: string): Promise<void>;
  /**
   * Press a key on the currently focused element (e.g. after ui.type).
   * Accepts a single character or a named key: Enter, Tab, Backspace,
   * Delete, Escape, ArrowLeft/Right/Up/Down, Home, End, PageUp, PageDown.
   */
  press(key: string): Promise<void>;
  /** Start an auto-waiting assertion on the element. */
  expect(selector: string): TripwireExpectation;
  /**
   * Pause for `ms` milliseconds as an explicit step (max 10 minutes).
   * Prefer assertions for waiting on app state — auto-wait handles most
   * timing; use wait() for animations, debounces, or background jobs that
   * have no observable DOM change to assert on.
   */
  wait(ms: number): Promise<void>;
  /**
   * Delay every subsequent action/assertion by `ms` milliseconds (0 turns it
   * off). Useful to watch a run at human speed or to pace a script against a
   * slow application without sprinkling wait() calls.
   */
  setSlowMo(ms: number): Promise<void>;
  /** Change the auto-wait timeout for subsequent steps (default 10000 ms). */
  setDefaultTimeout(ms: number): Promise<void>;
}

interface TripwirePage {
  /**
   * Navigate the target tab and wait for the page load event.
   * Relative URLs resolve against the tab's current page.
   */
  goto(url: string): Promise<void>;
}

declare const ui: TripwireUi;
declare const page: TripwirePage;
