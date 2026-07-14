import type { ImageAttachment } from "../../core/imageAttachments";
import type {
  ChatSession,
  ClientMessage,
  SessionState
} from "../../domain/chat/sessionModel";
import type { RenderSnapshot } from "../../runtime/streamui/types";
import type { StartGeneratedArtifactBatchInput } from "../artifacts/generatedArtifactBatchController";
import { getResolvedArtifactEditId } from "../artifacts/artifactEditModel";
import {
  getAssistantForUserTurn,
  getVisibleSessionMessages
} from "./branching";
import type { SendStreamUiRequestOptions } from "./chatRunRequest";

export type MessageRevisionBranchInput = {
  session: ChatSession;
  visibleMessages: ClientMessage[];
  userIndex: number;
  assistantId?: string;
  nextUserContent: string;
  attachments?: ImageAttachment[];
  appendUserMessage?: boolean;
  userMessagePatch?: Partial<ClientMessage>;
  assistantPatch?: Partial<ClientMessage>;
  initialReasoning?: string;
  requestHistory?: SendStreamUiRequestOptions["requestHistory"];
  preserveFollowingMessages?: boolean;
};

export type MessageRevisionControllerPorts = {
  getState(): SessionState;
  getActiveSessionId(): string;
  isBusy(): boolean;
  regenerateArtifactEdit(assistantId: string, editId: string): unknown;
  startGeneratedArtifactBatch(input: StartGeneratedArtifactBatchInput): unknown;
  startVisualRepair(
    assistantId: string,
    snapshot: RenderSnapshot,
    width: number
  ): unknown;
  startBranchedTurn(input: MessageRevisionBranchInput): boolean;
};

export type MessageRevisionController = {
  regenerateAssistant(assistantId: string): void;
  editUserMessage(messageId: string, content: string): boolean;
};

function getActiveSession(
  state: SessionState,
  activeSessionId: string
): ChatSession | undefined {
  return (
    state.sessions.find((session) => session.id === activeSessionId) ??
    state.sessions[0]
  );
}

function findPreviousUserIndex(
  messages: ClientMessage[],
  assistantIndex: number
): number {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return index;
    }
  }
  return -1;
}

export function createMessageRevisionController(
  ports: MessageRevisionControllerPorts
): MessageRevisionController {
  return {
    regenerateAssistant(assistantId) {
      const session = getActiveSession(
        ports.getState(),
        ports.getActiveSessionId()
      );
      if (!session) {
        return;
      }
      const visibleMessages = getVisibleSessionMessages(session);
      const assistantIndex = visibleMessages.findIndex(
        (message) =>
          message.id === assistantId && message.role === "assistant"
      );
      if (assistantIndex < 0) {
        return;
      }

      const activeAssistant = visibleMessages[assistantIndex];
      const userIndex = findPreviousUserIndex(visibleMessages, assistantIndex);
      if (userIndex < 0) {
        return;
      }

      const activeArtifactEditId = getResolvedArtifactEditId(activeAssistant);
      if (activeArtifactEditId) {
        ports.regenerateArtifactEdit(assistantId, activeArtifactEditId);
        return;
      }

      if (
        activeAssistant.artifactEdits?.length ||
        activeAssistant.artifactEditBaseRawStream
      ) {
        ports.startGeneratedArtifactBatch({
          sessionId: session.id,
          assistantId: activeAssistant.id,
          sourceUserMessageId: visibleMessages[userIndex].id,
          prompt: visibleMessages[userIndex].content,
          initialReasoning: "Thinking"
        });
        return;
      }

      if (activeAssistant.repairOfMessageId) {
        const originalRepairSnapshot = session.messages.find(
          (message) =>
            message.id === activeAssistant.repairOfMessageId &&
            message.role === "assistant" &&
            message.snapshot?.status === "complete"
        )?.snapshot;
        const repairSnapshot =
          activeAssistant.snapshot?.status === "complete"
            ? activeAssistant.snapshot
            : originalRepairSnapshot;
        if (!repairSnapshot) {
          return;
        }

        ports.startVisualRepair(activeAssistant.id, repairSnapshot, 900);
        return;
      }

      ports.startBranchedTurn({
        session,
        visibleMessages,
        userIndex,
        assistantId,
        nextUserContent: visibleMessages[userIndex].content
      });
    },

    editUserMessage(messageId, content) {
      if (ports.isBusy()) {
        return false;
      }
      const session = getActiveSession(
        ports.getState(),
        ports.getActiveSessionId()
      );
      if (!session) {
        return false;
      }
      const visibleMessages = getVisibleSessionMessages(session);
      const userIndex = visibleMessages.findIndex(
        (message) => message.id === messageId && message.role === "user"
      );
      const nextUserContent = content.trim();
      if (userIndex < 0 || !nextUserContent) {
        return false;
      }
      if (nextUserContent === visibleMessages[userIndex].content.trim()) {
        return false;
      }

      const activeAssistant = getAssistantForUserTurn(
        visibleMessages,
        userIndex
      );
      return ports.startBranchedTurn({
        session,
        visibleMessages,
        userIndex,
        assistantId: activeAssistant?.id,
        nextUserContent,
        preserveFollowingMessages: true
      });
    }
  };
}
