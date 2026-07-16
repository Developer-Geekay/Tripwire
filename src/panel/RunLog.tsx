import type { RunState, StepRecord } from "../engine/runner";

const STATUS_ICON: Record<StepRecord["status"], string> = {
  running: "…",
  passed: "✓",
  failed: "✗",
};

interface RunLogProps {
  steps: StepRecord[];
  runState: RunState;
  runMessage?: string;
}

export function RunLog({ steps, runState, runMessage }: RunLogProps) {
  return (
    <div className="runlog">
      {steps.length === 0 && runState === "idle" && (
        <p className="runlog-empty">Hit Run to execute the script against your active tab.</p>
      )}
      <ol className="runlog-steps">
        {steps.map((step) => (
          <li key={step.id} className={`step step-${step.status}`}>
            <div className="step-line">
              <span className="step-icon">{STATUS_ICON[step.status]}</span>
              <span className="step-label">{step.label}</span>
              {step.durationMs !== undefined && (
                <span className="step-duration">{step.durationMs}ms</span>
              )}
            </div>
            {step.error && <div className="step-error">{step.error}</div>}
            {step.screenshot && (
              <img
                className="step-screenshot"
                src={step.screenshot}
                alt={`Screenshot at failure of: ${step.label}`}
              />
            )}
          </li>
        ))}
      </ol>
      {runState !== "idle" && runState !== "running" && runState !== "starting" && (
        <div className={`run-verdict run-verdict-${runState}`}>
          {runState.toUpperCase()}
          {runMessage ? ` — ${runMessage}` : ""}
        </div>
      )}
    </div>
  );
}
