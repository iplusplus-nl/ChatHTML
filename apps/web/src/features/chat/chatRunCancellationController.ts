import type { ClientMessage } from "../../domain/chat/sessionModel";
import type {
  CancelChatRunResult,
  ChatRunCancellationOutcome
} from "./chatApi";

export type ChatRunCancellationTarget = {
  runId: string;
  sessionId: string;
  assistantId: string;
};

export type ChatRunCancellationResolution =
  | {
      kind: "applied";
      target: ChatRunCancellationTarget;
      result: CancelChatRunResult;
    }
  | {
      kind: "deferred";
      target: ChatRunCancellationTarget;
      result?: CancelChatRunResult;
    }
  | {
      kind: "not-accepted";
      target: ChatRunCancellationTarget;
    };

export type ChatRunCancellationErrorScope =
  | "acceptance"
  | "request"
  | "load"
  | "settle"
  | "reconcile";

export type ChatRunCancellationControllerOptions = {
  waitUntilAccepted(target: ChatRunCancellationTarget): Promise<boolean>;
  request(
    target: ChatRunCancellationTarget,
    signal: AbortSignal
  ): Promise<CancelChatRunResult>;
  loadMessage(
    target: ChatRunCancellationTarget
  ): Promise<ClientMessage | undefined>;
  settle(
    target: ChatRunCancellationTarget,
    result: CancelChatRunResult,
    message?: ClientMessage
  ): Promise<"applied" | "deferred">;
  reconcile(target: ChatRunCancellationTarget): void | Promise<void>;
  onError?(
    scope: ChatRunCancellationErrorScope,
    error: unknown,
    target: ChatRunCancellationTarget
  ): void;
  acceptanceTimeoutMs?: number;
  requestTimeoutMs?: number;
  loadTimeoutMs?: number;
  settleTimeoutMs?: number;
  reconcileTimeoutMs?: number;
  scheduleTimeout?(task: () => void, timeoutMs: number): () => void;
  createAbortController?(): AbortController;
};

export type ChatRunCancellationController = {
  cancel(
    target: ChatRunCancellationTarget
  ): Promise<ChatRunCancellationResolution>;
  isPending(runId: string): boolean;
};

type TimedResult<T> =
  | { kind: "value"; value: T }
  | { kind: "timeout" };

const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LOAD_TIMEOUT_MS = 5_000;
const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;
const DEFAULT_RECONCILE_TIMEOUT_MS = 10_000;

function defaultScheduleTimeout(
  task: () => void,
  timeoutMs: number
): () => void {
  const timer = setTimeout(task, timeoutMs);
  return () => clearTimeout(timer);
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  scheduleTimeout: (task: () => void, timeoutMs: number) => () => void
): Promise<TimedResult<T>> {
  return new Promise<TimedResult<T>>((resolve, reject) => {
    let settled = false;
    const cancelTimeout = scheduleTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ kind: "timeout" });
    }, timeoutMs);
    void promise.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimeout();
        resolve({ kind: "value", value });
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimeout();
        reject(error);
      }
    );
  });
}

export function isExactChatRunTerminalMessage(
  target: ChatRunCancellationTarget,
  outcome: ChatRunCancellationOutcome,
  message: ClientMessage | undefined
): message is ClientMessage {
  return Boolean(
    message?.id === target.assistantId &&
      message.role === "assistant" &&
      message.generationRunId === target.runId &&
      message.generationOutcome === outcome &&
      message.status === (outcome === "error" ? "error" : "complete")
  );
}

export function createChatRunCancellationController(
  options: ChatRunCancellationControllerOptions
): ChatRunCancellationController {
  const pending = new Map<
    string,
    Promise<ChatRunCancellationResolution>
  >();

  const reportError = (
    scope: ChatRunCancellationErrorScope,
    error: unknown,
    target: ChatRunCancellationTarget
  ) => {
    try {
      options.onError?.(scope, error, target);
    } catch {
      // Error reporting must never change cancellation ownership.
    }
  };

  const reconcile = async (target: ChatRunCancellationTarget) => {
    try {
      const reconciled = await waitWithTimeout(
        Promise.resolve().then(() => options.reconcile(target)),
        options.reconcileTimeoutMs ?? DEFAULT_RECONCILE_TIMEOUT_MS,
        options.scheduleTimeout ?? defaultScheduleTimeout
      );
      if (reconciled.kind === "timeout") {
        reportError(
          "reconcile",
          new Error(`Chat run ${target.runId} reconciliation timed out.`),
          target
        );
      }
    } catch (error) {
      reportError("reconcile", error, target);
    }
  };

  const run = async (
    target: ChatRunCancellationTarget
  ): Promise<ChatRunCancellationResolution> => {
    let acceptance: TimedResult<boolean>;
    try {
      acceptance = await waitWithTimeout(
        options.waitUntilAccepted(target),
        options.acceptanceTimeoutMs ?? DEFAULT_ACCEPTANCE_TIMEOUT_MS,
        options.scheduleTimeout ?? defaultScheduleTimeout
      );
    } catch (error) {
      reportError("acceptance", error, target);
      return { kind: "not-accepted", target };
    }
    if (acceptance.kind === "value" && !acceptance.value) {
      return { kind: "not-accepted", target };
    }
    if (acceptance.kind === "timeout") {
      reportError(
        "acceptance",
        new Error(`Chat run ${target.runId} acceptance timed out.`),
        target
      );
    }

    let result: CancelChatRunResult;
    const requestController = (
      options.createAbortController ?? (() => new AbortController())
    )();
    try {
      const requested = await waitWithTimeout(
        options.request(target, requestController.signal),
        options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        options.scheduleTimeout ?? defaultScheduleTimeout
      );
      if (requested.kind === "timeout") {
        requestController.abort();
        throw new Error(`Chat run ${target.runId} cancellation timed out.`);
      }
      result = requested.value;
      if (result.runId !== target.runId) {
        throw new Error(
          `Cancellation result belongs to ${result.runId}, not ${target.runId}.`
        );
      }
    } catch (error) {
      reportError("request", error, target);
      await reconcile(target);
      return { kind: "deferred", target };
    }

    let message: ClientMessage | undefined;
    try {
      const loaded = await waitWithTimeout(
        Promise.resolve().then(() => options.loadMessage(target)),
        options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
        options.scheduleTimeout ?? defaultScheduleTimeout
      );
      if (loaded.kind === "timeout") {
        reportError(
          "load",
          new Error(`Chat run ${target.runId} message load timed out.`),
          target
        );
      } else if (
        isExactChatRunTerminalMessage(target, result.outcome, loaded.value)
      ) {
        message = loaded.value;
      }
    } catch (error) {
      reportError("load", error, target);
    }

    if (result.outcome !== "cancelled" && !message) {
      await reconcile(target);
      return { kind: "deferred", target, result };
    }

    try {
      const settlement = await waitWithTimeout(
        Promise.resolve().then(() => options.settle(target, result, message)),
        options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS,
        options.scheduleTimeout ?? defaultScheduleTimeout
      );
      if (settlement.kind === "timeout") {
        reportError(
          "settle",
          new Error(`Chat run ${target.runId} settlement timed out.`),
          target
        );
      } else if (settlement.value === "applied") {
        return { kind: "applied", target, result };
      }
    } catch (error) {
      reportError("settle", error, target);
    }

    await reconcile(target);
    return { kind: "deferred", target, result };
  };

  return {
    cancel(target) {
      const existing = pending.get(target.runId);
      if (existing) {
        return existing;
      }

      const current = run(target);
      pending.set(target.runId, current);
      void current.finally(() => {
        if (pending.get(target.runId) === current) {
          pending.delete(target.runId);
        }
      });
      return current;
    },
    isPending(runId) {
      return pending.has(runId);
    }
  };
}
