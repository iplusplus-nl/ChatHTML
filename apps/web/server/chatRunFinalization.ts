export type ChatRunTerminalOutcome = "complete" | "error" | "cancelled";

export type ChatRunPersistenceTerminalStatus = "complete" | "error";

export type ChatRunTerminalTransition = {
  outcome: ChatRunTerminalOutcome;
  streamEvent: {
    type: "done";
    status: ChatRunTerminalOutcome;
    error?: string;
  };
  persistence: {
    status: ChatRunPersistenceTerminalStatus;
    error?: string;
  };
};

export function createChatRunTerminalTransition(
  status: ChatRunPersistenceTerminalStatus,
  error: string | undefined,
  cancelRequested: boolean
): ChatRunTerminalTransition {
  const outcome: ChatRunTerminalOutcome = cancelRequested
    ? "cancelled"
    : status;
  return {
    outcome,
    streamEvent: {
      type: "done",
      status: outcome,
      ...(outcome === "error" && error ? { error } : {})
    },
    persistence: { status, error }
  };
}

type ChatRunTerminalFinalization = {
  outcome: ChatRunTerminalOutcome;
  persistTerminalState: (outcome: ChatRunTerminalOutcome) => void | Promise<void>;
  waitForExecution: (outcome: ChatRunTerminalOutcome) => void | Promise<void>;
  cleanupEphemeralFiles: (outcome: ChatRunTerminalOutcome) => void | Promise<void>;
  cleanupAttempts?: number;
};

export async function finalizeChatRunTerminal({
  outcome,
  persistTerminalState,
  waitForExecution,
  cleanupEphemeralFiles,
  cleanupAttempts = 3
}: ChatRunTerminalFinalization): Promise<void> {
  try {
    await persistTerminalState(outcome);
  } finally {
    await waitForExecution(outcome);
    let cleanupError: unknown;
    let cleaned = false;
    const attempts = Math.max(1, Math.round(cleanupAttempts));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await cleanupEphemeralFiles(outcome);
        cleaned = true;
        break;
      } catch (error) {
        cleanupError = error;
      }
    }
    if (!cleaned) {
      throw cleanupError;
    }
  }
}
