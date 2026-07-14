import type { ImageAttachment } from "../../core/imageAttachments";
import {
  createId as createSessionId,
  type ArtifactEditReference,
  type ChatSession,
  type ClientMessage,
  type SessionState
} from "../../domain/chat/sessionModel";
import type { PageThemeMode } from "../../runtime/streamui/types";
import { getVisibleSessionMessages } from "../chat/branching";
import type {
  SendStreamUiRequest,
  SendStreamUiRequestOptions
} from "../chat/chatRunRequest";
import type { ChatGenerationLease } from "../chat/generationActivityCoordinator";
import {
  getGeneratedArtifactBatchAssistantPatch,
  isGeneratedArtifactBatchSourceCurrent,
  prepareGeneratedArtifactBatch,
  reduceGeneratedArtifactBatchPatch,
  type GeneratedArtifactBatchOperation
} from "./generatedArtifactBatchModel";

export type GeneratedArtifactBatchHistoryMode =
  | "before-source-user"
  | "through-target-assistant";

export type StartGeneratedArtifactBatchInput = {
  sessionId: string;
  assistantId: string;
  sourceUserMessageId: string;
  prompt: string;
  references?: ArtifactEditReference[];
  attachments?: ImageAttachment[];
  assistantPatch?: Partial<ClientMessage>;
  initialReasoning?: string;
  historyMode?: GeneratedArtifactBatchHistoryMode;
  runId?: string;
  chatActivityLease?: ChatGenerationLease;
  ephemeralAttachments?: boolean;
  onRunInitialized?(): void;
  onRunAccepted?(): void;
};

export type GeneratedArtifactBatchCompletion =
  | { status: "fulfilled" }
  | { status: "rejected"; error: unknown };

export type StartGeneratedArtifactBatchResult =
  | { status: "busy" | "missing" | "invalid" | "failed" }
  | {
      status: "started";
      operation: GeneratedArtifactBatchOperation;
      initialization: Promise<boolean>;
      completion: Promise<GeneratedArtifactBatchCompletion>;
    };

export type GeneratedArtifactBatchControllerPorts = {
  getState(): SessionState;
  isBusy(): boolean;
  sendRequest: SendStreamUiRequest;
  saveNow(): Promise<unknown> | unknown;
  themeMode: PageThemeMode;
  createId?(prefix: string): string;
  now?(): number;
  warn?(message: string, error: unknown): void;
};

export type GeneratedArtifactBatchController = {
  start(
    input: StartGeneratedArtifactBatchInput
  ): StartGeneratedArtifactBatchResult;
};

function findLiveTarget(
  session: ChatSession,
  input: Pick<
    StartGeneratedArtifactBatchInput,
    "assistantId" | "sourceUserMessageId"
  >
): {
  visibleMessages: ClientMessage[];
  assistant: ClientMessage;
  assistantIndex: number;
  userIndex: number;
} | null {
  const visibleMessages = getVisibleSessionMessages(session);
  const assistantIndex = visibleMessages.findIndex(
    (message) =>
      message.id === input.assistantId && message.role === "assistant"
  );
  const userIndex = visibleMessages.findIndex(
    (message) =>
      message.id === input.sourceUserMessageId && message.role === "user"
  );
  if (assistantIndex < 0 || userIndex < 0 || userIndex >= assistantIndex) {
    return null;
  }

  return {
    visibleMessages,
    assistant: visibleMessages[assistantIndex],
    assistantIndex,
    userIndex
  };
}

function buildRequestHistory(
  mode: GeneratedArtifactBatchHistoryMode,
  assistantId: string,
  sourceUserMessageId: string
): NonNullable<SendStreamUiRequestOptions["requestHistory"]> {
  return (previousMessages, userMessage) => {
    const assistantIndex = previousMessages.findIndex(
      (message) => message.id === assistantId && message.role === "assistant"
    );
    const userIndex = previousMessages.findIndex(
      (message) => message.id === sourceUserMessageId && message.role === "user"
    );
    const cutoff =
      mode === "through-target-assistant" ? assistantIndex + 1 : userIndex;
    return [...previousMessages.slice(0, Math.max(0, cutoff)), userMessage];
  };
}

export function buildGeneratedArtifactBatchRequestPrompt(
  operation: GeneratedArtifactBatchOperation
): string {
  if (!operation.references.length) {
    return operation.prompt;
  }

  return [
    operation.prompt,
    "",
    "Selected artifact references are anchors for intent and disambiguation, not strict edit boundaries:",
    JSON.stringify(operation.references, null, 2)
  ].join("\n");
}

export function createGeneratedArtifactBatchController(
  ports: GeneratedArtifactBatchControllerPorts
): GeneratedArtifactBatchController {
  const createId = ports.createId ?? createSessionId;
  const now = ports.now ?? Date.now;
  const warn =
    ports.warn ??
    ((message: string, error: unknown) => {
      console.warn(message, error);
    });

  return {
    start(input) {
      if (ports.isBusy() && !input.chatActivityLease) {
        return { status: "busy" };
      }

      const session = ports
        .getState()
        .sessions.find((candidate) => candidate.id === input.sessionId);
      if (!session) {
        return { status: "missing" };
      }
      const target = findLiveTarget(session, input);
      if (!target) {
        return { status: "missing" };
      }

      const operation = prepareGeneratedArtifactBatch(target.assistant, {
        sessionId: session.id,
        assistantId: target.assistant.id,
        sourceUserMessageId: input.sourceUserMessageId,
        prompt: input.prompt,
        references: input.references,
        runId: input.runId?.trim() || createId("run"),
        operationId: createId("artifact-edit-operation"),
        editId: createId("artifact-edit"),
        variantId: createId("artifact-edit-variant"),
        createdAt: now()
      });
      if (!operation) {
        return { status: "invalid" };
      }
      const generatedAssistantPatch =
        getGeneratedArtifactBatchAssistantPatch(
          target.assistant,
          operation,
          ports.themeMode
        );
      if (!generatedAssistantPatch) {
        return { status: "invalid" };
      }

      const historyMode = input.historyMode ?? "before-source-user";
      const validateRequestSession = (candidate: ChatSession) => {
        if (candidate.id !== operation.target.sessionId) {
          return false;
        }
        const liveTarget = findLiveTarget(candidate, input);
        return Boolean(
          liveTarget &&
            isGeneratedArtifactBatchSourceCurrent(
              liveTarget.assistant,
              operation
            )
        );
      };
      let resolveInitialization!: (initialized: boolean) => void;
      const initialization = new Promise<boolean>((resolve) => {
        resolveInitialization = resolve;
      });
      let request: Promise<void>;
      try {
        request = ports.sendRequest(
          buildGeneratedArtifactBatchRequestPrompt(operation),
          input.attachments ?? [],
          {
            appendUserMessage: false,
            assistantMessageId: operation.target.assistantId,
            generationRunId: operation.runId,
            chatActivityLease: input.chatActivityLease,
            ephemeralAttachments: input.ephemeralAttachments,
            onRunInitialized: input.onRunInitialized
              ? () => {
                  try {
                    input.onRunInitialized?.();
                  } finally {
                    resolveInitialization(true);
                  }
                }
              : undefined,
            onRunAccepted: input.onRunAccepted,
            targetSessionId: operation.target.sessionId,
            initialReasoning: input.initialReasoning ?? "Thinking",
            assistantPatch: {
              ...input.assistantPatch,
              ...generatedAssistantPatch
            },
            validateRequestSession,
            reduceAssistantPatch: (message, patch, phase) =>
              reduceGeneratedArtifactBatchPatch(
                message,
                operation,
                patch,
                phase,
                ports.themeMode
              ),
            onAssistantPhaseApplied: (phase) => {
              if (phase === "streaming") {
                return;
              }
              let save: Promise<unknown>;
              try {
                save = Promise.resolve(ports.saveNow());
              } catch (error) {
                warn("Could not save generated artifact batch state.", error);
                return;
              }
              void save.catch((error) => {
                warn("Could not save generated artifact batch state.", error);
              });
            },
            requestHistory: buildRequestHistory(
              historyMode,
              operation.target.assistantId,
              operation.target.sourceUserMessageId
            ),
            insertMessages: (messages, _userMessage, assistantMessage) => {
              const targetIndex = messages.findIndex(
                (message) =>
                  message.id === operation.target.assistantId &&
                  message.role === "assistant"
              );
              if (targetIndex < 0) {
                return messages;
              }
              return messages.map((message, index) =>
                index === targetIndex
                  ? { ...message, ...assistantMessage }
                  : message
              );
            }
          }
        );
      } catch (error) {
        warn("Could not run generated artifact batch.", error);
        return { status: "failed" };
      }
      const completion = request.then<
        GeneratedArtifactBatchCompletion,
        GeneratedArtifactBatchCompletion
      >(
        () => ({ status: "fulfilled" }),
        (error) => {
          warn("Could not run generated artifact batch.", error);
          return { status: "rejected", error };
        }
      );

      void completion.then(() => resolveInitialization(false));

      return { status: "started", operation, initialization, completion };
    }
  };
}
