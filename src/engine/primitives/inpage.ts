// This function is serialized with .toString() and executed inside the target
// page via Runtime.evaluate. It must stay fully self-contained: no imports, no
// references to anything outside its own body.

export interface ProbeState {
  found: boolean;
  visible: boolean;
  /** Normalized textContent — or the value for input/textarea/select. */
  text: string | null;
  /** Raw value for input/textarea/select elements, null otherwise. */
  value: string | null;
}

export interface ProbePoint {
  x: number;
  y: number;
}

export function tripwireProbe(
  descriptor: string,
  action: "state" | "point" | "focus",
): ProbeState | ProbePoint | boolean | null {
  const sep = descriptor.indexOf(":");
  const kind = descriptor.slice(0, sep);
  const target = descriptor.slice(sep + 1);
  const normalize = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

  // Framework compatibility: pierce open shadow roots (web components,
  // Angular/Lit/Stencil component libraries) — document.querySelector alone
  // cannot see into them.
  const collectRoots = (): Array<Document | ShadowRoot> => {
    const roots: Array<Document | ShadowRoot> = [document];
    for (let i = 0; i < roots.length; i++) {
      for (const el of roots[i].querySelectorAll("*")) {
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return roots;
  };

  const queryFirst = (selector: string): Element | null => {
    for (const root of collectRoots()) {
      try {
        const hit = root.querySelector(selector);
        if (hit) return hit;
      } catch {
        return null; // invalid selector
      }
    }
    return null;
  };

  let element: Element | null = null;
  if (kind === "css") {
    element = queryFirst(target);
  } else if (kind === "testid") {
    element = queryFirst(`[data-testid="${target.replace(/"/g, '\\"')}"]`);
  } else if (kind === "aria") {
    element = queryFirst(`[aria-label="${target.replace(/"/g, '\\"')}"]`);
  } else if (kind === "text") {
    // Innermost element whose whitespace-normalized text is an exact match:
    // traversal is document order with parents before children, so the last
    // match is the deepest one.
    const wanted = normalize(target);
    for (const root of collectRoots()) {
      for (const candidate of root.querySelectorAll("*")) {
        if (candidate.tagName === "SCRIPT" || candidate.tagName === "STYLE") continue;
        if (normalize(candidate.textContent) === wanted) element = candidate;
      }
    }
  }

  if (action === "state") {
    if (!element) return { found: false, visible: false, text: null, value: null };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";
    const field =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? element
        : null;
    return {
      found: true,
      visible,
      // For form fields the visible text IS the value; textContent is empty.
      text: field ? normalize(field.value) : normalize(element.textContent),
      value: field ? field.value : null,
    };
  }

  if (!element) return null;

  if (action === "point") {
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  if (action === "focus") {
    const el = element as HTMLElement;
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        el.select();
      }
    } else if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return document.activeElement === el || (el.getRootNode() as ShadowRoot).activeElement === el;
  }

  return null;
}
