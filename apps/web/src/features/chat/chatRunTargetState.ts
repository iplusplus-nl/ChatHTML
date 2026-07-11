import {
  sortSessions,
  summarizeSession,
  type ChatSession,
  type ClientMessage,
  type SessionState
} from "../../domain/chat/sessionModel";
import type { PageThemeMode } from "../../runtime/streamui/types";
import { compactCancelledBranchRuns } from "../../domain/chat/branchRunLifecycle";
import {
  reduceGeneratedArtifactBatchPatch,
  restoreGeneratedArtifactBatchOperation
} from "../artifacts/generatedArtifactBatchModel";
import { createCancelledAssistantPatch } from "./chatErrors";
import type {
  ChatRunCancellationOutcome,
  CancelChatRunResult
} from "./chatApi";
import {
  isExactChatRunTerminalMessage,
  type ChatRunCancellationTarget
} from "./chatRunCancellationController";

export function getStreamingChatRunTargets(
  session: ChatSession | undefined
): ChatRunCancellationTarget[] {
  if (!session) {
    return [];
  }
  return session.messages.flatMap((message) =>
    message.role === "assistant" &&
    message.status === "streaming" &&
    message.generationRunId
      ? [
          {
            runId: message.generationRunId,
            sessionId: session.id,
            assistantId: message.id
          }
        ]
      : []
  );
}

function mergeAuthoritativePatch(
  message: ClientMessage,
  patch: Partial<ClientMessage>
): ClientMessage {
  const {
    id: _id,
    role: _role,
    generationRunId: _generationRunId,
    ...safePatch
  } = patch;
  return {
    ...message,
    ...safePatch,
    id: message.id,
    role: message.role,
    generationRunId: message.generationRunId
  };
}

function reduceTargetMessage(
  message: ClientMessage,
  target: ChatRunCancellationTarget,
  patch: Partial<ClientMessage>,
  outcome: ChatRunCancellationOutcome,
  themeMode: PageThemeMode
): ClientMessage {
  if (
    message.id !== target.assistantId ||
    message.role !== "assistant" ||
    message.generationRunId !== target.runId
  ) {
    return message;
  }

  const generatedBatch = restoreGeneratedArtifactBatchOperation(
    target.sessionId,
    message
  );
  if (generatedBatch) {
    return reduceGeneratedArtifactBatchPatch(
      message,
      generatedBatch,
      patch,
      outcome,
      themeMode
    );
  }
  return mergeAuthoritativePatch(message, patch);
}

export function applyAuthoritativeChatRunResult(
  state: SessionState,
  target: ChatRunCancellationTarget,
  result: CancelChatRunResult,
  message: ClientMessage | undefined,
  themeMode: PageThemeMode,
  now = Date.now()
): SessionState {
  if (result.runId !== target.runId) {
    return state;
  }
  const exactMessage = isExactChatRunTerminalMessage(
    target,
    result.outcome,
    message
  )
    ? message
    : undefined;
  if (result.outcome !== "cancelled" && !exactMessage) {
    return state;
  }

  const sessionIndex = state.sessions.findIndex(
    (session) => session.id === target.sessionId
  );
  if (sessionIndex < 0) {
    return state;
  }
  const session = state.sessions[sessionIndex];
  const messageIndex = session.messages.findIndex(
    (candidate) => candidate.id === target.assistantId
  );
  if (messageIndex < 0) {
    return state;
  }
  const current = session.messages[messageIndex];
  if (
    current.generationOutcome &&
    current.generationOutcome !== result.outcome
  ) {
    return state;
  }
  const patch =
    exactMessage ??
    createCancelledAssistantPatch(
      current.rawStream ?? "",
      current.reasoning ?? "",
      current.streamSequence ?? 0
    );
  const nextMessage = reduceTargetMessage(
    current,
    target,
    patch,
    result.outcome,
    themeMode
  );
  if (nextMessage === current) {
    return state;
  }

  const messages = [...session.messages];
  messages[messageIndex] = nextMessage;
  const sessions = [...state.sessions];
  const nextSession = compactCancelledBranchRuns({
    ...session,
    updatedAt: now,
    messages
  });
  sessions[sessionIndex] = {
    ...nextSession,
    title: summarizeSession(nextSession.messages)
  };
  return { ...state, sessions: sortSessions(sessions) };
}
