// Message protocol between the panel (RPC host, owns the CDP session) and the
// sandboxed script executor page (owns the eval'd user script).

export type Command =
  | { kind: "goto"; url: string }
  | { kind: "click"; target: string }
  | { kind: "type"; target: string; text: string }
  | {
      kind: "expect";
      target: string;
      assertion: "toHaveText" | "toExist";
      expected?: string;
      negated: boolean;
    }
  | { kind: "setDefaultTimeout"; ms: number };

export interface RunMessage {
  type: "tripwire:run";
  runId: string;
  code: string;
}

export interface CallMessage {
  type: "tripwire:call";
  runId: string;
  callId: number;
  command: Command;
}

export interface ResultMessage {
  type: "tripwire:result";
  callId: number;
  ok: boolean;
  error?: string;
}

export interface DoneMessage {
  type: "tripwire:done";
  runId: string;
  ok: boolean;
  error?: string;
}

export type SandboxToHost = CallMessage | DoneMessage;
export type HostToSandbox = RunMessage | ResultMessage;

export function commandLabel(command: Command): string {
  switch (command.kind) {
    case "goto":
      return `goto ${command.url}`;
    case "click":
      return `click ${command.target}`;
    case "type":
      return `type ${command.target} ${JSON.stringify(command.text)}`;
    case "expect": {
      const not = command.negated ? ".not" : "";
      const arg = command.expected !== undefined ? JSON.stringify(command.expected) : "";
      return `expect ${command.target} ${not}.${command.assertion}(${arg})`;
    }
    case "setDefaultTimeout":
      return `setDefaultTimeout ${command.ms}ms`;
  }
}
