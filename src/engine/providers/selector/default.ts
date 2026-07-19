import type { ResolvedSelector, SelectorProvider } from "./types";

// Default reference syntax (Playwright-flavored):
//   "#login"            → CSS (the default)
//   "css=#login"        → CSS, explicit
//   "text=welcome"      → case-insensitive substring match on visible text
//   "text=\"Welcome\""  → exact, whitespace-normalized text match
//   "testid=submit-btn" → [data-testid="submit-btn"]
//   "aria=Close dialog" → [aria-label="Close dialog"]
//
// Segments can be chained with ">>" to scope the search to a parent:
//   "#orders >> text=pending" finds the text only inside #orders.
const PREFIXES = ["css", "text", "testid", "aria"] as const;

function normalizeSegment(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;
  for (const prefix of PREFIXES) {
    if (trimmed.startsWith(`${prefix}=`)) {
      return `${prefix}:${trimmed.slice(prefix.length + 1)}`;
    }
  }
  return `css:${trimmed}`;
}

export class DefaultSelectorProvider implements SelectorProvider {
  readonly namespace = null;

  canResolve(_ref: string): boolean {
    return true;
  }

  resolve(ref: string): Promise<ResolvedSelector | null> {
    const segments = ref.split(">>").map(normalizeSegment);
    if (segments.length === 0 || segments.some((s) => s === null)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ selector: segments.join(">>") });
  }
}
