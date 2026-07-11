import type { ClientMessage } from "../../domain/chat/sessionModel";
import type { StreamingRenderer } from "../../runtime/streamui/types";
import type { ChatRunCancellationOutcome } from "./chatApi";
import {
  createCancelledAssistantPatch,
  isAbortError
} from "./chatErrors";
import {
  presentLocalChatRunTerminal,
  projectStreamingChatRun,
  type LocalChatRunTerminalPresentation
} from "./chatRunPresentation";
import type { ChatRunAssistantPhase } from "./chatRunRequest";
import {
  createChatRunState,
  reduceChatRunState,
  type ChatRunState
} from "./chatRunStateMachine";
import {
  createChatStreamLineHandler,
  type ChatStreamTerminalStatus,
  type SequencedMemoryStreamEvent
} from "./chatStreamEvents";

export type ChatRunExecutionOutcome =
  | { kind: "server-terminal"; state: ChatRunState }
  | {
      kind: "local-terminal";
      state: ChatRunState;
      presentation: LocalChatRunTerminalPresentation;
      applied: boolean;
    }
  | { kind: "stale"; state: ChatRunState }
  | { kind: "detached"; state: ChatRunState }
  | { kind: "unhandled"; state: ChatRunState };

export type ChatRunExecutionErrorScope =
  | "reconcile"
  | "after-local-complete";

export type ChatRunAuthoritativeSettlement =
  | {
      kind: "applied";
      outcome: ChatRunCancellationOutcome;
      state: ChatRunState;
      applied: boolean;
    }
  | {
      kind: "deferred" | "stale";
      outcome: ChatRunCancellationOutcome;
      state: ChatRunState;
    };

export type ChatRunExecutionControllerOptions = {
  runId: string;
  initial?: {
    raw?: string;
    reasoning?: string;
    streamSequence?: number;
  };
  renderer: Pick<
    StreamingRenderer,
    "replace" | "complete" | "getSnapshot"
  >;
  signal: AbortSignal;
  isConnectionCurrent(): boolean;
  abortConnection(): void;
  applyAssistant(
    patch: Partial<ClientMessage>,
    phase: ChatRunAssistantPhase
  ): boolean;
  onMemory(event: SequencedMemoryStreamEvent): void;
  loadServerMessage(): Promise<ClientMessage | undefined>;
  onProgress?(): void;
  afterLocalComplete?(input: {
    state: ChatRunState;
    patch: Partial<ClientMessage>;
  }): void | Promise<void>;
  onError?(scope: ChatRunExecutionErrorScope, error: unknown): void;
  reconcileIntervalMs?: number;
  scheduleInterval?(task: () => void, intervalMs: number): () => void;
};

export type ChatRunExecutionController = {
  handleLine(line: string): void;
  startReconcile(): void;
  reconcileNow(): Promise<void>;
  settleAuthoritative(input: {
    outcome: ChatRunCancellationOutcome;
    message?: ClientMessage;
  }): Promise<ChatRunAuthoritativeSettlement>;
  finishTransport(): Promise<ChatRunExecutionOutcome>;
  handleTransportError(error: unknown): Promise<ChatRunExecutionOutcome>;
  checkpointStreaming(): boolean;
  getState(): ChatRunState;
  dispose(): void;
};

const DEFAULT_RECONCILE_INTERVAL_MS = 1_500;

function getMessageTerminalOutcome(
  message: ClientMessage
): ChatRunCancellationOutcome | undefined {
  return message.generationOutcome;
}

function isExactAuthoritativeMessage(
  message: ClientMessage | undefined,
  runId: string,
  outcome: ChatRunCancellationOutcome
): message is ClientMessage {
  return Boolean(
      message?.role === "assistant" &&
      message.generationRunId === runId &&
      getMessageTerminalOutcome(message) === outcome &&
      message.status === (outcome === "error" ? "error" : "complete")
  );
}

function defaultScheduleInterval(
  task: () => void,
  intervalMs: number
): () => void {
  const interval = setInterval(task, intervalMs);
  return () => clearInterval(interval);
}

export function createChatRunExecutionController(
  options: ChatRunExecutionControllerOptions
): ChatRunExecutionController {
  let state = createChatRunState({
    runId: options.runId,
    raw: options.initial?.raw,
    reasoning: options.initial?.reasoning,
    streamSequence: options.initial?.streamSequence
  });
  let disposed = false;
  let reconcilePromise: Promise<void> | null = null;
  let cancelReconcileInterval: (() => void) | null = null;
  let localTerminalOutcomePromise: Promise<ChatRunExecutionOutcome> | null =
    null;

  const reportError = (
    scope: ChatRunExecutionErrorScope,
    error: unknown
  ) => {
    try {
      options.onError?.(scope, error);
    } catch {
      // Error reporting must not alter run ownership or terminal state.
    }
  };

  const reportProgress = () => {
    try {
      options.onProgress?.();
    } catch {
      // Progress is advisory and must not interrupt the stream.
    }
  };

  const dispatch = (
    event: Parameters<typeof reduceChatRunState>[1]
  ) => {
    const result = reduceChatRunState(state, event);
    state = result.state;
    return result;
  };

  const canAcceptConnectionEvent = () => {
    if (disposed) {
      return false;
    }
    if (
      !options.isConnectionCurrent() ||
      (options.signal.aborted && state.terminal?.source !== "server")
    ) {
      dispatch({ type: "cancel" });
      return false;
    }
    return true;
  };

  const applyLocalTerminal = (): Promise<ChatRunExecutionOutcome> => {
    if (localTerminalOutcomePromise) {
      return localTerminalOutcomePromise;
    }

    localTerminalOutcomePromise = (async () => {
      if (!options.isConnectionCurrent()) {
        return { kind: "stale", state } as ChatRunExecutionOutcome;
      }
      const presentation = presentLocalChatRunTerminal(
        state,
        options.renderer
      );
      if (!presentation) {
        return { kind: "unhandled", state } as ChatRunExecutionOutcome;
      }

      const applied = options.applyAssistant(
        presentation.patch,
        presentation.phase
      );
      const outcome: ChatRunExecutionOutcome = {
        kind: "local-terminal",
        state,
        presentation,
        applied
      };

      if (
        applied &&
        presentation.phase === "complete" &&
        options.afterLocalComplete
      ) {
        try {
          await options.afterLocalComplete({
            state,
            patch: presentation.patch
          });
        } catch (error) {
          reportError("after-local-complete", error);
        }
      }

      return outcome;
    })();
    return localTerminalOutcomePromise;
  };

  const applyServerMessage = (message: ClientMessage) => {
    if (!canAcceptConnectionEvent()) {
      return false;
    }

    const result = dispatch({ type: "server", message });
    if (!result.accepted || !result.phase || !result.assistantPatch) {
      return false;
    }

    reportProgress();
    try {
      return options.applyAssistant(result.assistantPatch, result.phase);
    } finally {
      if (result.abortConnection) {
        options.abortConnection();
      }
    }
  };

  const handleContent = (text: string, sequence?: number) => {
    if (!canAcceptConnectionEvent()) {
      return;
    }
    const result = dispatch({ type: "content", text, sequence });
    if (!result.accepted) {
      return;
    }

    reportProgress();
    const projection = projectStreamingChatRun(
      state.raw,
      typeof sequence === "number" ? state.streamSequence : undefined
    );
    if (projection.streamUiSource !== undefined) {
      options.renderer.replace(projection.streamUiSource);
    }
    const snapshot =
      projection.streamUiSource !== undefined
        ? options.renderer.getSnapshot()
        : undefined;
    options.applyAssistant(
      {
        ...projection.patch,
        ...(snapshot ? { snapshot } : {})
      },
      "streaming"
    );
  };

  const handleReasoning = (text: string, sequence?: number) => {
    if (!canAcceptConnectionEvent()) {
      return;
    }
    const result = dispatch({ type: "reasoning", text, sequence });
    if (!result.accepted) {
      return;
    }

    reportProgress();
    options.applyAssistant(
      {
        reasoning: state.reasoning,
        ...(typeof sequence === "number"
          ? { streamSequence: state.streamSequence }
          : {})
      },
      "streaming"
    );
  };

  const handleMemory = (
    event: SequencedMemoryStreamEvent,
    sequence?: number
  ) => {
    if (!canAcceptConnectionEvent()) {
      return;
    }
    const result = dispatch({ type: "memory", sequence });
    if (!result.accepted) {
      return;
    }

    reportProgress();
    options.onMemory(event);
    if (typeof sequence === "number") {
      options.applyAssistant(
        { streamSequence: state.streamSequence },
        "streaming"
      );
    }
  };

  const handleDone = (
    status: ChatStreamTerminalStatus,
    error: string,
    sequence?: number
  ) => {
    if (!canAcceptConnectionEvent()) {
      return;
    }
    const result = dispatch({ type: "done", status, error, sequence });
    if (!result.accepted) {
      return;
    }

    reportProgress();
    if (typeof sequence === "number") {
      options.applyAssistant(
        { streamSequence: state.streamSequence },
        "streaming"
      );
    }
  };

  const handleLine = createChatStreamLineHandler({
    runId: options.runId,
    getLastSequence: () => state.streamSequence,
    onSequence: () => undefined,
    onContent: handleContent,
    onReasoning: handleReasoning,
    onMemory: handleMemory,
    onDone: handleDone
  });

  const checkpointStreaming = () => {
    if (disposed || state.terminal || !options.isConnectionCurrent()) {
      return false;
    }
    return options.applyAssistant(
      {
        reasoning: state.reasoning,
        rawStream: state.raw,
        streamSequence: state.streamSequence,
        generationOutcome: undefined,
        status: "streaming"
      },
      "streaming"
    );
  };

  const reconcileNow = (): Promise<void> => {
    if (disposed || state.terminal?.source === "server") {
      return Promise.resolve();
    }
    if (reconcilePromise) {
      return reconcilePromise;
    }

    const current = (async () => {
      try {
        const message = await options.loadServerMessage();
        if (disposed || !message) {
          return;
        }
        applyServerMessage(message);
      } catch (error) {
        reportError("reconcile", error);
      }
    })();
    reconcilePromise = current;
    void current.finally(() => {
      if (reconcilePromise === current) {
        reconcilePromise = null;
      }
    });
    return current;
  };

  return {
    handleLine,
    startReconcile() {
      if (disposed || cancelReconcileInterval) {
        return;
      }
      void reconcileNow();
      try {
        cancelReconcileInterval = (
          options.scheduleInterval ?? defaultScheduleInterval
        )(
          () => {
            void reconcileNow();
          },
          options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS
        );
      } catch (error) {
        reportError("reconcile", error);
      }
    },
    reconcileNow,
    async settleAuthoritative({ outcome, message }) {
      if (disposed || !options.isConnectionCurrent()) {
        return { kind: "stale", outcome, state };
      }

      if (isExactAuthoritativeMessage(message, options.runId, outcome)) {
        const applied = applyServerMessage(message);
        if (
          state.terminal?.source === "server" &&
          state.terminal.phase === outcome
        ) {
          return { kind: "applied", outcome, state, applied };
        }
        return { kind: "deferred", outcome, state };
      }

      if (outcome !== "cancelled") {
        return { kind: "deferred", outcome, state };
      }

      const result = dispatch({ type: "authoritative-cancel" });
      if (!result.accepted) {
        return state.terminal?.source === "server" &&
          state.terminal.phase === "cancelled"
          ? { kind: "applied", outcome, state, applied: false }
          : { kind: "deferred", outcome, state };
      }

      reportProgress();
      const patch = createCancelledAssistantPatch(
        state.raw,
        state.reasoning,
        state.streamSequence
      );
      try {
        const applied = options.applyAssistant(patch, "cancelled");
        return { kind: "applied", outcome, state, applied };
      } finally {
        options.abortConnection();
      }
    },
    async finishTransport() {
      await reconcileNow();
      if (state.terminal?.source === "server") {
        return { kind: "server-terminal", state };
      }

      const eof = dispatch({ type: "eof" });
      if (eof.eofDisposition === "detached") {
        return { kind: "detached", state };
      }
      return applyLocalTerminal();
    },
    async handleTransportError(error) {
      if (state.terminal?.source === "server") {
        return { kind: "server-terminal", state };
      }
      if (
        !options.isConnectionCurrent() ||
        options.signal.aborted ||
        isAbortError(error)
      ) {
        dispatch({ type: "cancel" });
        return applyLocalTerminal();
      }
      if (state.terminal?.source === "stream") {
        return applyLocalTerminal();
      }
      return { kind: "unhandled", state };
    },
    checkpointStreaming,
    getState() {
      return state;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelReconcileInterval?.();
      cancelReconcileInterval = null;
    }
  };
}
