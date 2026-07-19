// Built-in usage documentation. Lives inside the extension so users learn the
// API where they write scripts — every example can be inserted into the editor.

interface DocsProps {
  onInsert(code: string): void;
}

function Example({ code, onInsert }: { code: string; onInsert(code: string): void }) {
  return (
    <div className="docs-example">
      <pre>{code}</pre>
      <button className="btn btn-small" onClick={() => onInsert(code)} title="Insert into editor">
        insert
      </button>
    </div>
  );
}

export function Docs({ onInsert }: DocsProps) {
  return (
    <div className="docs">
      <h2>Quick start</h2>
      <ol>
        <li>Open the app you want to test in a normal browser tab.</li>
        <li>Write a script here — <code>page</code> and <code>ui</code> are in scope, top-level <code>await</code> works.</li>
        <li>Hit <b>run</b>. Tripwire drives your active tab; steps stream into the log below.</li>
        <li>A failing step captures a screenshot inline. The yellow "is being debugged" bar on the tab is normal and disappears when the run ends.</li>
        <li>Use <b>pick</b> to grab a selector by clicking an element on the page.</li>
      </ol>
      <Example
        onInsert={onInsert}
        code={`await page.goto("https://example.com/");
await ui.expect("h1").toHaveText("Example Domain");
await ui.click("text=More information...");
`}
      />

      <h2>Actions — what to use when</h2>
      <dl>
        <dt><code>page.goto(url)</code></dt>
        <dd>Navigate and wait for the page load. Relative URLs resolve against the tab's current page.</dd>
        <dt><code>ui.click(selector)</code></dt>
        <dd>Trusted click at the element's center. Waits for the element to be visible first.</dd>
        <dt><code>ui.type(selector, text)</code></dt>
        <dd>
          Clears the field, then simulates real typing — every character fires
          keydown/input/keyup. Use for inputs with masks, autocomplete,
          typeahead, or any app logic bound to keyboard events. <code>"\n"</code> presses Enter.
        </dd>
        <dt><code>ui.fill(selector, text)</code></dt>
        <dd>
          Sets the whole value in one shot (single trusted input event, no
          per-key events). Faster — use for plain forms and long strings. If a
          field misbehaves with one of type/fill, try the other: that tells you
          what the app listens to.
        </dd>
        <dt><code>ui.clear(selector)</code></dt>
        <dd>Empty a field as its own step (select-all + Backspace).</dd>
        <dt><code>ui.press(key)</code></dt>
        <dd>
          Press a key on whatever has focus — use after type/fill to submit or
          navigate: <code>Enter</code>, <code>Tab</code>, <code>Escape</code>, arrows, or any single character.
        </dd>
      </dl>
      <Example
        onInsert={onInsert}
        code={`await ui.type("#username", "admin");
await ui.type("#password", "secret");
await ui.press("Enter");
`}
      />

      <h2>Selectors</h2>
      <table>
        <tbody>
          <tr><td><code>#login</code></td><td>CSS (the default). Pierces open shadow roots.</td></tr>
          <tr><td><code>text=pending</code></td><td>case-insensitive substring of visible text; picks the deepest visible element</td></tr>
          <tr><td><code>text="Pending"</code></td><td>exact text match (whitespace-normalized)</td></tr>
          <tr><td><code>testid=submit</code></td><td><code>[data-testid="submit"]</code> — the most stable choice when available</td></tr>
          <tr><td><code>aria=Close dialog</code></td><td><code>[aria-label="Close dialog"]</code></td></tr>
          <tr><td><code>#orders &gt;&gt; text=pending</code></td><td>scoped: each <code>&gt;&gt;</code> segment searches inside the previous match — use for rows/cards with repeated markup</td></tr>
        </tbody>
      </table>
      <p>
        For <b>clicks</b>, target the actual control (the click lands at the element's
        center). For <b>assertions</b>, a parent container is fine — its text includes
        all children.
      </p>

      <h2>Assertions</h2>
      <dl>
        <dt><code>ui.expect(sel).toHaveText(t)</code></dt>
        <dd>Exact match of the element's whole text (or an input's value). Fails if extra text surrounds it.</dd>
        <dt><code>ui.expect(sel).toContainText(t)</code></dt>
        <dd>Substring match — usually what you want on sections and labels.</dd>
        <dt><code>ui.expect(sel).toHaveValue(v)</code></dt>
        <dd>Exact value of an input/textarea/select.</dd>
        <dt><code>ui.expect(sel).toExist()</code> / <code>.not.toExist()</code></dt>
        <dd>Presence in the DOM. <code>.not</code> inverts any assertion.</dd>
      </dl>
      <p>
        Every action and assertion <b>auto-waits</b>: it retries until it succeeds or the
        timeout (default 10s) elapses. Prefer raising the timeout
        (<code>await ui.setDefaultTimeout(20000);</code>) over manual pauses. When you do
        need explicit pacing: <code>await ui.wait(1500);</code> pauses once;
        <code>await ui.setSlowMo(500);</code> delays every following step — handy for
        watching a run at human speed. <code>ui.setSlowMo(0)</code> turns it off.
      </p>
      <Example
        onInsert={onInsert}
        code={`await ui.expect("#order-summary").toContainText("Total");
await ui.expect("#qty").toHaveValue("3");
await ui.expect(".error").not.toExist();
`}
      />

      <h2>Troubleshooting</h2>
      <dl>
        <dt>"element not found" but I can see it</dt>
        <dd>
          Try <code>toContainText</code> instead of <code>toHaveText</code>; try an unquoted
          <code> text=</code> (substring, case-insensitive). If the element lives inside an
          <b> iframe</b>, it is not reachable yet — that limitation is on the roadmap.
        </dd>
        <dt>Attach fails / "already attached"</dt>
        <dd>Close DevTools on the target tab — only one debugger can attach per tab.</dd>
        <dt>The yellow banner</dt>
        <dd>
          Inherent to the trusted-input engine; it disappears when the run ends. Launch the
          browser with <code>--silent-debugger-extension-api</code> to suppress it.
        </dd>
        <dt>Typing lands but the app ignores it</dt>
        <dd>Switch between <code>ui.type</code> and <code>ui.fill</code> — apps listen to different events.</dd>
        <dt>Debugging Tripwire itself</dt>
        <dd>
          Install the <b>dev build</b> from the download page, then right-click inside this
          panel → Inspect. A <code>debugger;</code> line in your script pauses the run when
          DevTools is open.
        </dd>
      </dl>
    </div>
  );
}
