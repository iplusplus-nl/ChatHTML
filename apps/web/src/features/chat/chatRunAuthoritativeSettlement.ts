import type {
  ClientMessage,
  SessionState
} from "../../domain/chat/sessionModel";
import type { PageThemeMode } from "../../runtime/streamui/types";
import type { CancelChatRunResult } from "./chatApi";
import {
  isExactChatRunTerminalMessage,
  type ChatRunCancellationTarget
} from "./chatRunCancellationController";
import type { ChatRunExecutionController } from "./chatRunExecutionController";
import { applyAuthoritativeChatRunResult } from "./chatRunTargetState";

type RuntimeView = {
  waitUntilExecution(): Promise<ChatRunExecutionController | undefined>;
};

export type ChatRunAuthoritativeSettlementPorts = {
  getRuntime(target: ChatRunCancellationTarget): RuntimeView | undefined;
  updateState(updater: (current: SessionState) => SessionState): void;
  getThemeMode(): PageThemeMode;
  cancelReconnect(runId: string): void;
  getConnection(runId: string): { abort(): void } | undefined;
  removeConnection(runId: string, connection: { abort(): void } | undefined): void;
  finishActivity(runId: string): void;
  saveNow(): Promise<"saved" | "failed" | "skipped">;
  warn(message: string, error?: unknown): void;
  executionWaitTimeoutMs?: number;
  saveTimeoutMs?: number;
  scheduleTimeout?(task: () => void, timeoutMs: number): () => void;
};

type TimedResult<T> = { kind: "value"; value: T } | { kind: "timeout" };

const DEFAULT_EXECUTION_WAIT_TIMEOUT_MS = 2_000;
const DEFAULT_SAVE_TIMEOUT_MS = 5_000;

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
      if (!settled) {
        settled = true;
        resolve({ kind: "timeout" });
      }
    }, timeoutMs);
    void promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          cancelTimeout();
          resolve({ kind: "value", value });
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          cancelTimeout();
          reject(error);
        }
      }
    );
  });
}

export async function settleAuthoritativeChatRun(
  target: ChatRunCancellationTarget,
  result: CancelChatRunResult,
  message: ClientMessage | undefined,
  ports: ChatRunAuthoritativeSettlementPorts
): Promise<"applied" | "deferred"> {
  const runtime = ports.getRuntime(target);
  let execution: ChatRunExecutionController | undefined;
  if (runtime) {
    const executionWait = await waitWithTimeout(
      runtime.waitUntilExecution(),
      ports.executionWaitTimeoutMs ?? DEFAULT_EXECUTION_WAIT_TIMEOUT_MS,
      ports.scheduleTimeout ?? defaultScheduleTimeout
    );
    if (executionWait.kind === "timeout") {
      ports.warn("Timed out waiting for the active ChatHTML connection.");
    } else {
      execution = executionWait.value;
    }
  }
  if (execution) {
    try {
      await execution.settleAuthoritative({
        outcome: result.outcome,
        message
      });
    } catch (error) {
      ports.warn(
        "Could not settle ChatHTML run through its active connection.",
        error
      );
    }
  }

  let terminalApplied = false;
  ports.updateState((current) => {
    const next = applyAuthoritativeChatRunResult(
      current,
      target,
      result,
      message,
      ports.getThemeMode()
    );
    const terminalMessage = next.sessions
      .find((session) => session.id === target.sessionId)
      ?.messages.find((candidate) => candidate.id === target.assistantId);
    terminalApplied = isExactChatRunTerminalMessage(
      target,
      result.outcome,
      terminalMessage
    );
    return next;
  });
  if (!terminalApplied) {
    return "deferred";
  }

  ports.cancelReconnect(target.runId);
  const connection = ports.getConnection(target.runId);
  connection?.abort();
  ports.removeConnection(target.runId, connection);
  ports.finishActivity(target.runId);
  const saved = await waitWithTimeout(
    ports.saveNow(),
    ports.saveTimeoutMs ?? DEFAULT_SAVE_TIMEOUT_MS,
    ports.scheduleTimeout ?? defaultScheduleTimeout
  );
  if (saved.kind === "timeout") {
    ports.warn("Timed out persisting authoritative ChatHTML run state.");
  } else if (saved.value === "failed") {
    ports.warn("Could not persist authoritative ChatHTML run state.");
  }
  return "applied";
}
