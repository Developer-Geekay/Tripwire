/**
 * Tripwire script API.
 *
 * Scripts run with top-level await and two globals: `page` and `ui`.
 *
 * Selector syntax (everywhere a selector is accepted):
 *   "#login"            CSS selector (the default)
 *   "css=#login"        CSS selector, explicit
 *   "text=Welcome"      exact, whitespace-normalized text match
 *   "testid=submit-btn" matches [data-testid="submit-btn"]
 *   "aria=Close dialog" matches [aria-label="Close dialog"]
 *
 * Every action and assertion auto-waits: it retries until the element is
 * ready (or the assertion holds), then fails cleanly after the timeout.
 */

interface TripwireExpectation {
  /**
   * Assert the element's whitespace-normalized text content equals
   * `expected`. Retries until it matches or the timeout elapses.
   */
  toHaveText(expected: string): Promise<void>;
  /** Assert a matching element is present in the DOM. */
  toExist(): Promise<void>;
  /** Invert the assertion: `ui.expect(".error").not.toExist()`. */
  readonly not: TripwireExpectation;
}

interface TripwireUi {
  /** Wait for the element to be visible, then send a trusted click. */
  click(selector: string): Promise<void>;
  /**
   * Wait for the element to be visible, click to focus it, then type `text`,
   * replacing any existing content.
   */
  type(selector: string, text: string): Promise<void>;
  /** Start an auto-waiting assertion on the element. */
  expect(selector: string): TripwireExpectation;
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
