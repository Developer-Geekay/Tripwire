// Element picker overlay. Injected on demand via chrome.scripting.executeScript
// as a plain (non-module) script — it must stay free of top-level exports and
// only import modules that get inlined into this chunk.
//
// Hover highlights the element under the cursor and shows the ranked selector
// suggestion in a tooltip; click picks it (sent back over chrome.runtime);
// Escape cancels.

import { rankSelector } from "./selector-rank";

(() => {
  const flag = "__tripwirePickerActive";
  const w = window as unknown as Record<string, unknown>;
  if (w[flag]) return;
  w[flag] = true;

  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;z-index:2147483646;pointer-events:none;" +
    "border:2px solid #3fb950;background:rgba(63,185,80,0.15);border-radius:2px;" +
    "left:0;top:0;width:0;height:0;transition:all 40ms linear;";

  const tip = document.createElement("div");
  tip.style.cssText =
    "position:fixed;z-index:2147483647;pointer-events:none;" +
    "background:#161b22;color:#3fb950;border:1px solid #30363d;border-radius:4px;" +
    "padding:3px 8px;font:12px ui-monospace,Menlo,Consolas,monospace;" +
    "max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
    "left:0;top:0;display:none;";

  document.documentElement.append(box, tip);

  let current: Element | null = null;
  let currentRef = "";

  const onMove = (e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === tip || el === document.documentElement) return;
    if (el !== current) {
      current = el;
      currentRef = rankSelector(el);
      const r = el.getBoundingClientRect();
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      tip.textContent = currentRef;
      tip.style.display = "block";
    }
    tip.style.left = `${Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8)}px`;
  };

  const finish = (ref: string | null) => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mousedown", onSuppress, true);
    document.removeEventListener("mouseup", onSuppress, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    box.remove();
    tip.remove();
    delete w[flag];
    void chrome.runtime.sendMessage(
      ref === null
        ? { type: "tripwire:pick-cancelled" }
        : { type: "tripwire:picked", ref },
    );
  };

  const onSuppress = (e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(current ? currentRef : null);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(null);
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mousedown", onSuppress, true);
  document.addEventListener("mouseup", onSuppress, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
})();
