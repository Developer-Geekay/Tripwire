// Selector strategy ranking: data-testid → id → aria-label → text → CSS path.
// Recorder quality IS selector quality (this is why Selenium IDE died), so the
// Phase 3 recorder reuses this exact module.
//
// Output uses the runner's reference syntax (see types/ui.d.ts): a plain
// string is CSS; "testid=", "aria=", "text=" are the prefixed forms.

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function normalize(s: string | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// Mirrors the engine's text= semantics: the last (innermost) element in
// document order whose normalized text matches. A text ref is only safe when
// that pick is the element the user chose.
function textRefMatches(el: Element, text: string): boolean {
  let match: Element | null = null;
  for (const candidate of document.querySelectorAll("*")) {
    if (candidate.tagName === "SCRIPT" || candidate.tagName === "STYLE") continue;
    if (normalize(candidate.textContent) === text) match = candidate;
  }
  return match === el;
}

function cssPath(el: Element): string {
  const segments: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    if (node.id && isUnique(`#${CSS.escape(node.id)}`)) {
      segments.unshift(`#${CSS.escape(node.id)}`);
      return segments.join(" > ");
    }
    let segment = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    segments.unshift(segment);
    node = parent;
  }
  return segments.join(" > ");
}

export function rankSelector(el: Element): string {
  const testid = el.getAttribute("data-testid");
  if (testid && isUnique(`[data-testid="${CSS.escape(testid)}"]`)) {
    return `testid=${testid}`;
  }

  if (el.id && isUnique(`#${CSS.escape(el.id)}`)) {
    return `#${CSS.escape(el.id)}`;
  }

  const aria = el.getAttribute("aria-label");
  if (aria && isUnique(`[aria-label="${CSS.escape(aria)}"]`)) {
    return `aria=${aria}`;
  }

  const text = normalize(el.textContent);
  if (text && text.length <= 40 && !text.includes("=") && textRefMatches(el, text)) {
    return `text=${text}`;
  }

  return cssPath(el);
}
