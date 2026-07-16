// SelectorProvider is one of Tripwire's three permanent extension seams.
// Future implementations: OutSystems connector (`os:` namespace, Phase 6),
// WebMCP page-declared tools, and AI self-healing — all behind this interface.

export interface RunContext {
  tabId: number;
}

export interface ResolvedSelector {
  /**
   * Normalized query descriptor understood by the in-page probe:
   * `css:<selector>` | `text:<exact text>` | `testid:<value>` | `aria:<label>`.
   */
  selector: string;
}

export interface SelectorProvider {
  /** Namespace this provider owns (e.g. "os"), or null for the default. */
  namespace: string | null;
  canResolve(ref: string): boolean;
  resolve(ref: string, ctx: RunContext): Promise<ResolvedSelector | null>;
}

export class SelectorRegistry {
  constructor(private providers: SelectorProvider[]) {}

  async resolve(ref: string, ctx: RunContext): Promise<ResolvedSelector | null> {
    for (const provider of this.providers) {
      if (!provider.canResolve(ref)) continue;
      const resolved = await provider.resolve(ref, ctx);
      if (resolved) return resolved;
    }
    return null;
  }
}
