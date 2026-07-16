import type { ResolvedSelector, SelectorProvider } from "./types";

// Default reference syntax (Playwright-flavored):
//   "#login"            → CSS (the default)
//   "css=#login"        → CSS, explicit
//   "text=Welcome"      → exact, whitespace-normalized text match
//   "testid=submit-btn" → [data-testid="submit-btn"]
//   "aria=Close dialog" → [aria-label="Close dialog"]
const PREFIXES = ["css", "text", "testid", "aria"] as const;

export class DefaultSelectorProvider implements SelectorProvider {
  readonly namespace = null;

  canResolve(_ref: string): boolean {
    return true;
  }

  resolve(ref: string): Promise<ResolvedSelector | null> {
    const trimmed = ref.trim();
    if (!trimmed) return Promise.resolve(null);
    for (const prefix of PREFIXES) {
      if (trimmed.startsWith(`${prefix}=`)) {
        return Promise.resolve({
          selector: `${prefix}:${trimmed.slice(prefix.length + 1)}`,
        });
      }
    }
    return Promise.resolve({ selector: `css:${trimmed}` });
  }
}
