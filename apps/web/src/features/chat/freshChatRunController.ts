import {
  serializeApiSettings,
  type ApiSettings
} from "../../core/apiSettings";
import { serializeSearchSettings, type SearchSettings } from "../../core/searchSettings";
import type {
  ClientMessage,
  SessionFile
} from "../../domain/chat/sessionModel";
import { createStreamingRenderer } from "../../runtime/streamui/streamingRenderer";
import type {
  PageThemeMode,
  StreamingRenderer
} from "../../runtime/streamui/types";
import { uploadSessionFile } from "../sessions/sessionApi";
import { createArtifactFileUpload } from "../sessions/sessionFileModel";
import { toApiMessages } from "./apiMessages";
import {
  claimAcceptedChatRunResponse,
  readNdjsonLines,
  startChatRun
} from "./chatApi";
import {
  getEphemeralChatRunFileIds,
  getChatRunRequestFiles
} from "./chatRunAttachmentFiles";
import { formatChatHttpError, sanitizeChatErrorMessage } from "./chatErrors";
import {
  createChatRunExecutionController,
  type ChatRunExecutionController,
  type ChatRunExecutionControllerOptions
} from "./chatRunExecutionController";
import type { FreshChatRunMessagePlan } from "./freshChatRunPlan";
import type {
  ChatRunAssistantPhase,
  SendStreamUiRequestOptions
} from "./chatRunRequest";
import type { SequencedMemoryStreamEvent } from "./chatStreamEvents";

export type FreshChatRunRegistration = {
  markAccepted(): boolean;
  attachExecution(
    execution: ChatRunExecutionController
  ): (() => boolean) | undefined;
  end(): boolean;
};

export type FreshChatRunLease = {
  release(): void;
};

export type FreshChatRunControllerOptions = {
  sessionId: string;
  plan: FreshChatRunMessagePlan;
  sendOptions: SendStreamUiRequestOptions;
  requestApiSettings: ApiSettings;
  searchSettings: SearchSettings;
  themeMode: PageThemeMode;
  activityLease: FreshChatRunLease;
  runtimeRegistration: FreshChatRunRegistration;
  connections: Map<string, AbortController>;
  renderers: Map<string, StreamingRenderer>;
  initializeSession(): void;
  discardUnacceptedRun(): void;
  updateAssistant(
    patch: Partial<ClientMessage>,
    phase?: ChatRunAssistantPhase
  ): boolean;
  onMemory(event: SequencedMemoryStreamEvent): void;
  loadServerMessage(): Promise<ClientMessage | undefined>;
  getClientId(): string;
  getSessionFiles(): readonly SessionFile[];
  getCanvasContext(): unknown;
  upsertSessionFiles(files: SessionFile[]): void;
  refreshManagedAuth(): unknown | Promise<unknown>;
  createAbortController?(): AbortController;
  createRenderer?(themeMode: PageThemeMode): StreamingRenderer;
  createExecution?(
    options: ChatRunExecutionControllerOptions
  ): ChatRunExecutionController;
  startRequest?(
    payload: unknown,
    clientId: string,
    signal: AbortSignal
  ): Promise<Response>;
  readLines?(
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void
  ): Promise<void>;
  uploadArtifactFile?(
    sessionId: string,
    file: Parameters<typeof uploadSessionFile>[1],
    clientId: string
  ): Promise<SessionFile>;
  scheduleInterval?(task: () => void, intervalMs: number): () => void;
  warn?(message: string, error?: unknown): void;
};

function defaultScheduleInterval(
  task: () => void,
  intervalMs: number
): () => void {
  const intervalId = window.setInterval(task, intervalMs);
  return () => window.clearInterval(intervalId);
}

export function runFreshChatRun(
  options: FreshChatRunControllerOptions
): Promise<void> {
  const {
    assistantId,
    assistantMessage,
    generationRunId,
    preparedAttachmentFiles,
    previousMessages,
    userMessage
  } = options.plan;
  const createRenderer = options.createRenderer ?? createStreamingRenderer;
  const createExecution =
    options.createExecution ?? createChatRunExecutionController;
  const startRequest = options.startRequest ?? startChatRun;
  const readLines = options.readLines ?? readNdjsonLines;
  const uploadArtifactFile = options.uploadArtifactFile ?? uploadSessionFile;
  const scheduleInterval = options.scheduleInterval ?? defaultScheduleInterval;
  const warn = options.warn ?? ((message, error) => console.warn(message, error));
  let renderer: StreamingRenderer | null = null;
  let streamController: AbortController | null = null;
  let unsubscribeSnapshot: (() => void) | null = null;
  let detachExecution: (() => boolean) | undefined;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    try {
      unsubscribeSnapshot?.();
    } catch (error) {
      warn("Could not unsubscribe ChatHTML renderer.", error);
    }
    if (renderer && options.renderers.get(assistantId) === renderer) {
      options.renderers.delete(assistantId);
    }
    if (
      streamController &&
      options.connections.get(generationRunId) === streamController
    ) {
      options.connections.delete(generationRunId);
    }
    detachExecution?.();
    options.runtimeRegistration.end();
    options.activityLease.release();
  };

  try {
    renderer = createRenderer(options.themeMode);
    options.renderers.set(assistantId, renderer);
    streamController =
      options.createAbortController?.() ?? new AbortController();
    options.connections.set(generationRunId, streamController);
    unsubscribeSnapshot = renderer.onSnapshot((snapshot) => {
      options.updateAssistant({ snapshot }, "streaming");
    });
    options.initializeSession();
  } catch (error) {
    cleanup();
    options.discardUnacceptedRun();
    warn("Could not initialize ChatHTML run.", error);
    return Promise.resolve();
  }

  if (!renderer || !streamController || !unsubscribeSnapshot) {
    cleanup();
    options.discardUnacceptedRun();
    return Promise.resolve();
  }

  let execution: ChatRunExecutionController;
  try {
    execution = createExecution({
      runId: generationRunId,
      initial: { reasoning: options.sendOptions.initialReasoning },
      renderer,
      signal: streamController.signal,
      isConnectionCurrent: () =>
        options.connections.get(generationRunId) === streamController,
      abortConnection: () => streamController?.abort(),
      applyAssistant: (patch, phase) => options.updateAssistant(patch, phase),
      onMemory: options.onMemory,
      loadServerMessage: options.loadServerMessage,
      afterLocalComplete: async ({ state, patch }) => {
        const artifactUpload = createArtifactFileUpload(
          assistantId,
          state.raw,
          patch.snapshot,
          patch.artifactContext?.textSummary
        );
        if (!artifactUpload) {
          return;
        }
        options.upsertSessionFiles([
          await uploadArtifactFile(
            options.sessionId,
            artifactUpload,
            options.getClientId()
          )
        ]);
      },
      onError: (scope, error) => {
        warn(
          scope === "reconcile"
            ? "Could not reconcile ChatHTML stream state."
            : "Could not persist ChatHTML artifact file.",
          error
        );
      },
      scheduleInterval
    });
    detachExecution = options.runtimeRegistration.attachExecution(execution);
  } catch (error) {
    cleanup();
    options.discardUnacceptedRun();
    options.updateAssistant(
      {
        content: "I could not complete that request.",
        error: "The chat request could not be initialized.",
        generationOutcome: "error",
        status: "error"
      },
      "error"
    );
    warn("Could not initialize ChatHTML stream handler.", error);
    return Promise.resolve();
  }

  return (async () => {
    let streamConnected = false;
    try {
      const requestHistory =
        typeof options.sendOptions.requestHistory === "function"
          ? options.sendOptions.requestHistory(
              previousMessages,
              userMessage,
              assistantMessage
            )
          : options.sendOptions.requestHistory ?? [
              ...previousMessages,
              userMessage
            ];
      const requestFiles = getChatRunRequestFiles(
        options.getSessionFiles(),
        preparedAttachmentFiles
      );
      execution.startReconcile();

      const clientId = options.getClientId();
      const response = await startRequest(
        {
          clientId,
          sessionId: options.sessionId,
          runId: generationRunId,
          userMessage:
            options.sendOptions.persistUserMessage ??
            (options.plan.appendUserMessage ? userMessage : undefined),
          assistantMessage,
          messages: toApiMessages(requestHistory),
          files: requestFiles,
          ephemeralFileIds: getEphemeralChatRunFileIds(
            preparedAttachmentFiles
          ),
          canvas: options.getCanvasContext(),
          themeMode: options.themeMode,
          apiSettings: serializeApiSettings(options.requestApiSettings),
          searchSettings: serializeSearchSettings(options.searchSettings)
        },
        clientId,
        streamController.signal
      );

      const acceptedResponse = claimAcceptedChatRunResponse(
        response,
        () => {
          options.runtimeRegistration.markAccepted();
          options.sendOptions.onRunAccepted?.();
        },
        (error) => {
          warn("Chat run acceptance observer failed.", error);
        }
      );
      if (!acceptedResponse) {
        const errorText = await response.text();
        throw new Error(formatChatHttpError(response, errorText));
      }
      streamConnected = true;

      await readLines(acceptedResponse.body, execution.handleLine);
      const outcome = await execution.finishTransport();
      if (outcome.kind === "detached") {
        execution.checkpointStreaming();
      }
    } catch (error) {
      const outcome = await execution.handleTransportError(error);
      if (outcome.kind !== "unhandled") {
        return;
      }
      const runState = execution.getState();
      const message =
        error instanceof Error
          ? sanitizeChatErrorMessage(error.message)
          : "The chat request failed.";
      if (streamConnected) {
        execution.checkpointStreaming();
        return;
      }
      options.updateAssistant(
        {
          content: "I could not complete that request.",
          error: message,
          reasoning: runState.reasoning,
          rawStream: runState.raw,
          streamSequence: runState.streamSequence,
          generationOutcome: "error",
          status: "error"
        },
        "error"
      );
    } finally {
      execution.dispose();
      cleanup();
      if (options.requestApiSettings.apiKeySource === "managed") {
        try {
          void Promise.resolve(options.refreshManagedAuth()).catch((error) => {
            warn("Could not refresh ChatHTML Cloud account.", error);
          });
        } catch (error) {
          warn("Could not refresh ChatHTML Cloud account.", error);
        }
      }
    }
  })();
}
