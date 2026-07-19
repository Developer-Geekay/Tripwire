# Tripwire

**An in-browser UI test runner.** Tampermonkey ergonomics, Playwright semantics, zero toolchain.

Tripwire is a Chrome/Edge (MV3) extension that runs UI tests **entirely in the browser** — no Node.js, no CI runner, no headless browser, no install step beyond the extension itself.

```js
await page.goto("/login");
await ui.click("#login");
await ui.type("#username", "admin");
await ui.expect("#message").toHaveText("Welcome");
await ui.expect(".error").not.toExist();
```

Built for QA engineers, analysts, and devs testing **internal enterprise web apps**, where standing up Playwright/Selenium infrastructure is disproportionate to the need: smoke tests, regression checks, repeatable manual flows.

## What it is (and isn't)

- **Attended automation.** Tests run while your browser is open. That's a feature: no infra approval, no pipeline access, no service accounts. Tripwire is not a CI replacement.
- **Chromium only.** Chrome and Edge. The engine is the Chrome DevTools Protocol (`chrome.debugger`) — the same protocol Playwright speaks — which is the only in-extension path to **trusted** input events (`isTrusted: true`), real screenshots, and navigation control.
- **Auto-waiting everywhere.** Every action and assertion retries until the element is ready or the timeout elapses. No `sleep(3000)`.
- **The yellow banner.** While a test runs, Chrome shows an "is being debugged" info bar on the target tab. That's inherent to the CDP engine and cannot be hidden by the extension — it also means nothing is happening behind your back. It disappears when the run ends. To suppress it entirely, launch the browser with the `--silent-debugger-extension-api` flag (add it to the shortcut target, or roll it out via managed browser settings for QA machines).
- **DevTools conflict.** Only one debugger can attach to a tab. If DevTools is open on the target tab, Tripwire tells you instead of failing silently.
- **AI-optional.** Planned AI assistance (on-device, Chrome's Prompt API) is strictly additive; the runner is fully usable without it.
- **Agent-friendly (planned).** A later phase exposes the runner as MCP tools (`run_test`, `list_tests`, `get_last_report`) so agents like Claude Code can trigger tests and read failures + screenshots.

## Using it

1. Build: `npm install && npm run build`
2. Load: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`
3. Open the page you want to test in a normal tab.
4. Click the Tripwire toolbar icon — the side panel opens with an editor.
5. Write your script (IntelliSense included) and hit **run**. Steps stream into the log; failures capture a screenshot inline.
6. Use **pick** to grab a selector straight from the page: hover highlights elements with a ranked selector suggestion (`data-testid` → `id` → `aria` → text → CSS path), click inserts it at the cursor, Esc cancels.
7. Manage multiple scripts in the library bar (new/rename/delete); **export**/**import** moves them as JSON so they can live in git.

### Selector syntax

| Ref | Meaning |
|---|---|
| `#login` | CSS selector (default) |
| `css=#login` | CSS, explicit |
| `text=welcome` | case-insensitive substring match on visible text (deepest visible element) |
| `text="Welcome"` | exact, whitespace-normalized text match |
| `testid=submit` | `[data-testid="submit"]` |
| `aria=Close dialog` | `[aria-label="Close dialog"]` |
| `#orders >> text=pending` | scoped search: each `>>` segment searches within the previous match |

## Releases

**Download page: https://developer-geekay.github.io/Tripwire/** — the latest build's zip and crx are served straight from `github.io`, which usually stays reachable on corporate networks that block direct `github.com` downloads. The page shows the version, source commit, and sha256 checksums.

Prebuilt packages are also published on the [Releases](../../releases) page for every `v*` tag:

- **`tripwire-<version>-chromium.zip`** — unzip and *Load unpacked* in `chrome://extensions` / `edge://extensions`. The easiest way to test.
- **`tripwire-<version>-chromium-dev.zip`** — debuggable build: unminified with sourcemaps, installs as "Tripwire (Dev)". Use it to step through extension code in DevTools when investigating issues.
- **`tripwire-<version>.crx`** — signed CRX3 package. Chrome on Windows/macOS blocks `.crx` installs from outside the Web Store, so use the zip for manual testing; the `.crx` is for Linux, Edge, and enterprise policy deployment.

Cut a release by pushing a tag (`git tag v0.2.0 && git push origin v0.2.0`) — CI builds, packages, and attaches both artifacts. Locally, `npm run package` produces the same files in `release/`. Set the `CRX_PRIVATE_KEY` repo secret (PEM) to keep the extension ID stable across releases; locally the key persists in the gitignored `.crx-key.pem`.

## Debugging

Install the **dev zip** (`tripwire-<version>-chromium-dev.zip`, unminified + sourcemaps, shows up as "Tripwire (Dev)") and open DevTools on the surface you're interested in:

| Context | How to inspect |
|---|---|
| Runner + UI (most issues) | right-click inside the side panel → Inspect |
| Service worker | `chrome://extensions` → Inspect views: service worker |
| Your test script | panel DevTools → Sources → the `sandbox.html` frame |
| Element picker | DevTools on the target page → Sources → Content scripts |

Breakpoints work in the original TypeScript via sourcemaps. A `debugger;` statement inside a test script pauses the run when the panel's DevTools is open. When filing an issue, include the failing step's log line (it reports the actual text/value found) and the console stack trace from the dev build.

## Development

```
npm install
npm run build      # typecheck + production build into dist/
npm run dev        # rebuild on change
npm run typecheck
```

Architecture, phasing, and the extension seams (selector providers, cross-extension connector protocol, AI provider) are documented in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).

```
src/
  panel/        React + Monaco UI (side panel and full-tab editor share it)
  content/      element picker overlay + selector ranking (recorder reuses it)
  background/   MV3 service worker (lifecycle; scheduling later)
  engine/
    cdp/        chrome.debugger session wrapper
    primitives/ goto, click, type, expect — each with built-in auto-wait
    providers/  selector + AI seams (default/no-op implementations)
  shared/       panel ⇄ sandbox message protocol
  types/ui.d.ts the script API contract (also powers editor IntelliSense)
public/
  sandbox.html  sandboxed executor for user scripts (eval is CSP-legal there)
```
