// This function is serialized with .toString() and executed inside the target
// page via Runtime.evaluate. It must stay fully self-contained: no imports, no
// references to anything outside its own body.

export interface ProbeState {
  found: boolean;
  visible: boolean;
  text: string | null;
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
  const value = descriptor.slice(sep + 1);
  const normalize = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

  let element: Element | null = null;
  if (kind === "css") {
    element = document.querySelector(value);
  } else if (kind === "testid") {
    element = document.querySelector(`[data-testid="${value.replace(/"/g, '\\"')}"]`);
  } else if (kind === "aria") {
    element = document.querySelector(`[aria-label="${value.replace(/"/g, '\\"')}"]`);
  } else if (kind === "text") {
    // Innermost element whose whitespace-normalized text is an exact match.
    // querySelectorAll is document order (parents first), so the last match
    // is the deepest one.
    const wanted = normalize(value);
    for (const candidate of document.querySelectorAll("*")) {
      if (candidate.tagName === "SCRIPT" || candidate.tagName === "STYLE") continue;
      if (normalize(candidate.textContent) === wanted) element = candidate;
    }
  }

  if (action === "state") {
    if (!element) return { found: false, visible: false, text: null };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";
    return { found: true, visible, text: normalize(element.textContent) };
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
    return document.activeElement === el;
  }

  return null;
}
