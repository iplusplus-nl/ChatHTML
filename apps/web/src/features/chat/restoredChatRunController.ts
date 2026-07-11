import {
  STREAM_INTERRUPTED_ERROR,
  type ClientMessage
} from "../../domain/chat/sessionModel";
import { createStreamingRenderer } from "../../runtime/streamui/streamingRenderer";
import type {
  PageThemeMode,
  StreamingRenderer
} from "../../runtime/streamui/types";
import { readNdjsonLines, requestChatRunEvents } from "./chatApi";
import { formatChatHttpError } from "./chatErrors";
import {
  createChatRunExecutionController,
  type ChatRunExecutionController,
  type ChatRunExecutionControllerOptions
} from "./chatRunExecutionController";
import type { ChatRunReconnectScheduler } from "./chatRunReconnectScheduler";
import { subscribeRestoredChatRunRenderer } from "./chatRunRendererLifecycle";
import type { ChatRunAssistantPhase } from "./chatRunRequest";
import type { SequencedMemoryStreamEvent } from "./chatStreamEvents";

export type RestoredChatRunLease = {
  release(): void;
};

export type RestoredChatRunRegistration = {
  attachExecution(
    execution: ChatRunExecutionController
  ): (() => boolean) | undefined;
  end(): boolean;
};

export type RestoredChatRunTarget = {
  runId: string;
  sessionId: string;
  assistant: ClientMessage;
  themeMode: PageThemeMode;
};

export type RestoredChatRunControllerOptions = {
  target: RestoredChatRunTarget;
  activityLease: RestoredChatRunLease;
  runtimeRegistration: RestoredChatRunRegistration;
  connections: Map<string, AbortController>;
  renderers: Map<string, StreamingRenderer>;
  reconnectScheduler: Pick<
    ChatRunReconnectScheduler,
    "cancel" | "markProgress" | "schedule"
  >;
  getClientId(): string;
  updateAssistant(
    patch: Partial<ClientMessage>,
    phase?: ChatRunAssistantPhase
  ): boolean;
  onMemory(event: SequencedMemoryStreamEvent): void;
  loadServerMessage(): Promise<ClientMessage | undefined>;
  isTargetStillStreaming(): boolean;
  retry(): void;
  createAbortController?(): AbortController;
  createRenderer?(themeMode: PageThemeMode): StreamingRenderer;
  subscribeRenderer?(input: {
    renderer: StreamingRenderer;
    rawStream?: string;
    onSnapshot(snapshot: ReturnType<StreamingRenderer["getSnapshot"]>): void;
  }): () => void;
  createExecution?(
    options: ChatRunExecutionControllerOptions
  ): ChatRunExecutionController;
  requestEvents?(
    runId: string,
    afterSequence: number,
    clientId: string,
    signal: AbortSignal
  ): Promise<Response>;
  readLines?(
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void
  ): Promise<void>;
  scheduleInterval?(task: () => void, intervalMs: number): () => void;
  warn?(message: string, error: unknown): void;
};

function defaultScheduleInterval(
  task: () => void,
  intervalMs: number
): () => void {
  const intervalId = window.setInterval(task, intervalMs);
  return () => window.clearInterval(intervalId);
}

export function runRestoredChatRun(
  options: RestoredChatRunControllerOptions
): Promise<void> {
  const {
    assistant,
    runId,
    themeMode
  } = options.target;
  const abortController =
    options.createAbortController?.() ?? new AbortController();
  const createRenderer = options.createRenderer ?? createStreamingRenderer;
  const subscribeRenderer =
    options.subscribeRenderer ?? subscribeRestoredChatRunRenderer;
  const createExecution =
    options.createExecution ?? createChatRunExecutionController;
  const requestEvents = options.requestEvents ?? requestChatRunEvents;
  const readLines = options.readLines ?? readNdjsonLines;
  const scheduleInterval = options.scheduleInterval ?? defaultScheduleInterval;
  const warn = options.warn ?? ((message, error) => console.warn(message, error));

  options.connections.set(runId, abortController);

  return (async () => {
    let renderer: StreamingRenderer | null = null;
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
      if (
        renderer &&
        options.renderers.get(assistant.id) === renderer
      ) {
        options.renderers.delete(assistant.id);
      }
      if (options.connections.get(runId) === abortController) {
        options.connections.delete(runId);
      }
      detachExecution?.();
      options.runtimeRegistration.end();
      options.activityLease.release();
    };

    try {
      renderer = createRenderer(themeMode);
      options.renderers.set(assistant.id, renderer);
      unsubscribeSnapshot = subscribeRenderer({
        renderer,
        rawStream: assistant.rawStream,
        onSnapshot: (snapshot) => {
          options.updateAssistant({ snapshot });
        }
      });
    } catch (error) {
      cleanup();
      options.updateAssistant(
        {
          content: "I could not complete that request.",
          generationOutcome: "error",
          status: "error",
          error: STREAM_INTERRUPTED_ERROR
        },
        "error"
      );
      warn("Could not restore ChatHTML renderer.", error);
      return;
    }

    if (!renderer || !unsubscribeSnapshot) {
      cleanup();
      return;
    }

    const isConnectionCurrent = () =>
      options.connections.get(runId) === abortController;
    let execution: ChatRunExecutionController;

    try {
      execution = createExecution({
        runId,
        initial: {
          raw: assistant.rawStream,
          reasoning: assistant.reasoning,
          streamSequence: assistant.streamSequence
        },
        renderer,
        signal: abortController.signal,
        isConnectionCurrent,
        abortConnection: () => abortController.abort(),
        applyAssistant: (patch, phase) =>
          options.updateAssistant(patch, phase),
        onMemory: options.onMemory,
        loadServerMessage: options.loadServerMessage,
        onProgress: () => options.reconnectScheduler.markProgress(runId),
        onError: (scope, error) => {
          if (
            scope === "reconcile" &&
            (error as { name?: unknown }).name !== "AbortError"
          ) {
            warn("Could not reconcile ChatHTML stream state.", error);
          }
        },
        scheduleInterval
      });
      detachExecution = options.runtimeRegistration.attachExecution(execution);
    } catch (error) {
      cleanup();
      options.updateAssistant(
        {
          content: "I could not complete that request.",
          generationOutcome: "error",
          status: "error",
          error: STREAM_INTERRUPTED_ERROR
        },
        "error"
      );
      warn("Could not restore ChatHTML stream handler.", error);
      return;
    }

    const scheduleReconnect = () => {
      if (
        execution.getState().terminal ||
        !isConnectionCurrent() ||
        abortController.signal.aborted
      ) {
        return;
      }
      options.reconnectScheduler.schedule(runId, () => {
        if (options.isTargetStillStreaming()) {
          options.retry();
        } else {
          options.reconnectScheduler.cancel(runId);
        }
      });
    };

    try {
      execution.startReconcile();
      const response = await requestEvents(
        runId,
        execution.getState().streamSequence,
        options.getClientId(),
        abortController.signal
      );

      if (response.status === 404) {
        await execution.reconcileNow();
        const runState = execution.getState();
        if (runState.terminal?.source === "server") {
          return;
        }
        if (!isConnectionCurrent() || abortController.signal.aborted) {
          await execution.handleTransportError(
            new DOMException("Chat run cancelled.", "AbortError")
          );
          return;
        }
        options.updateAssistant(
          {
            content: "I could not complete that request.",
            reasoning: runState.reasoning,
            rawStream: runState.raw,
            streamSequence: runState.streamSequence,
            generationOutcome: "error",
            status: "error",
            error: STREAM_INTERRUPTED_ERROR
          },
          "error"
        );
        return;
      }

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(formatChatHttpError(response, errorText));
      }

      await readLines(response.body, execution.handleLine);
      const outcome = await execution.finishTransport();
      if (outcome.kind === "detached") {
        scheduleReconnect();
      }
    } catch (error) {
      const outcome = await execution.handleTransportError(error);
      if (outcome.kind !== "unhandled") {
        return;
      }
      warn("Could not resume ChatHTML run.", error);
      scheduleReconnect();
    } finally {
      execution.dispose();
      cleanup();
    }
  })();
}
