import type { AiProvider, RunResult, Step } from "./types";

// Placeholder until the Prompt API implementation lands in Phase 7. Callers
// must gate every AI feature on availability(), so this keeps them all hidden.
export class NoopAiProvider implements AiProvider {
  availability(): Promise<"available" | "downloading" | "unavailable"> {
    return Promise.resolve("unavailable");
  }

  suggestSteps(_nl: string, _domContext: string): Promise<Step[]> {
    return Promise.reject(new Error("AI provider is unavailable"));
  }

  healSelector(_broken: string, _dom: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  summarizeFailure(_run: RunResult): Promise<string> {
    return Promise.reject(new Error("AI provider is unavailable"));
  }
}
