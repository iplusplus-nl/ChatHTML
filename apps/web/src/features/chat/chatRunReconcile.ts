import type { ClientMessage } from "../../domain/chat/sessionModel";
import { sanitizeChatErrorMessage } from "./chatErrors";

export type ChatRunReconcileState = {
  runId: string;
  raw: string;
  reasoning: string;
  streamSequence: number;
  doneStatus?: "complete" | "error";
  doneError: string;
  completedFromServer: boolean;
};

export type ChatRunReconcileResult = {
  accepted: boolean;
  state: ChatRunReconcileState;
  phase?: "streaming" | "complete" | "error";
  abortConnection: boolean;
};

function terminalAssistantStatus(
  status: ClientMessage["status"] | undefined
): "complete" | "error" | undefined {
  return status === "complete" || status === "error" ? status : undefined;
}

export function reconcileChatRunState(
  state: ChatRunReconcileState,
  serverMessage: ClientMessage
): ChatRunReconcileResult {
  if (serverMessage.role !== "assistant") {
    return { accepted: false, state, abortConnection: false };
  }
  if (
    serverMessage.generationRunId &&
    serverMessage.generationRunId !== state.runId
  ) {
    return { accepted: false, state, abortConnection: false };
  }

  const serverSequence = serverMessage.streamSequence ?? 0;
  const serverRaw = serverMessage.rawStream ?? "";
  const serverReasoning = serverMessage.reasoning ?? "";
  const terminalStatus = terminalAssistantStatus(serverMessage.status);
  const hasNewerStream =
    serverSequence > state.streamSequence ||
    serverRaw.length > state.raw.length ||
    serverReasoning.length > state.reasoning.length;
  const hasTerminalUpdate =
    Boolean(terminalStatus) && state.doneStatus !== terminalStatus;

  if (!hasNewerStream && !hasTerminalUpdate) {
    return { accepted: false, state, abortConnection: false };
  }

  const nextState: ChatRunReconcileState = {
    ...state,
    raw: serverRaw || state.raw,
    reasoning: serverReasoning || state.reasoning,
    streamSequence: Math.max(state.streamSequence, serverSequence),
    ...(terminalStatus
      ? {
          doneStatus: terminalStatus,
          doneError: sanitizeChatErrorMessage(serverMessage.error, ""),
          completedFromServer: true
        }
      : {})
  };

  return {
    accepted: true,
    state: nextState,
    phase: terminalStatus ?? "streaming",
    abortConnection: Boolean(terminalStatus)
  };
}
