import type { ChatRunTerminalOutcome } from "./chatRunFinalization.js";

export type ChatRunTerminalClaim = {
  outcome: ChatRunTerminalOutcome;
  error?: string;
};

export type ChatRunTerminalResult = {
  outcome: ChatRunTerminalOutcome;
  transitioned: boolean;
  persistence: Promise<void>;
};

export type ChatRunCancellationResponse = {
  runId: string;
  outcome: ChatRunTerminalOutcome;
  transitioned: boolean;
};

export type ChatRunTerminalCoordinator = {
  transition(
    outcome: ChatRunTerminalOutcome,
    error?: string
  ): ChatRunTerminalResult;
};

export function createChatRunTerminalCoordinator(options: {
  onTransition(claim: ChatRunTerminalClaim): void;
  persist(claim: ChatRunTerminalClaim): Promise<void>;
}): ChatRunTerminalCoordinator {
  let claim: ChatRunTerminalClaim | undefined;
  let persistence: Promise<void> | undefined;
  let persisted = false;

  const ensurePersistence = (): Promise<void> => {
    if (persistence) {
      return persistence;
    }
    if (!claim) {
      return Promise.reject(new Error("Chat run has no terminal outcome."));
    }

    let operation: Promise<void>;
    try {
      operation = Promise.resolve(options.persist(claim));
    } catch (error) {
      operation = Promise.reject(error);
    }

    const tracked = operation.then(
      () => {
        persisted = true;
      },
      (error) => {
        if (persistence === tracked) {
          persistence = undefined;
        }
        throw error;
      }
    );
    persistence = tracked;
    return tracked;
  };

  return {
    transition(outcome, error) {
      let transitioned = false;
      if (!claim) {
        const nextClaim = { outcome, ...(error ? { error } : {}) };
        claim = nextClaim;
        transitioned = true;
        options.onTransition(nextClaim);
      }

      return {
        outcome: claim.outcome,
        transitioned,
        persistence: persisted
          ? persistence ?? Promise.resolve()
          : ensurePersistence()
      };
    }
  };
}

export async function waitForChatRunCancellationResponse(
  runId: string,
  result: ChatRunTerminalResult
): Promise<ChatRunCancellationResponse> {
  await result.persistence;
  return {
    runId,
    outcome: result.outcome,
    transitioned: result.transitioned
  };
}
