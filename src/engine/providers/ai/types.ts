// AiProvider is one of Tripwire's three permanent extension seams. The default
// implementation will target the Chrome Prompt API (Gemini Nano, on-device) in
// Phase 7; the runner must stay fully usable when availability() is
// "unavailable".

export interface Step {
  kind: string;
  args: Record<string, unknown>;
}

export interface RunResult {
  ok: boolean;
  steps: Array<{ label: string; status: string; error?: string }>;
}

export interface AiProvider {
  availability(): Promise<"available" | "downloading" | "unavailable">;
  suggestSteps(nl: string, domContext: string): Promise<Step[]>;
  healSelector(broken: string, dom: string): Promise<string | null>;
  summarizeFailure(run: RunResult): Promise<string>;
}
