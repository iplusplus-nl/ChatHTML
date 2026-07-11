export type ChatRunReconnectTimer = unknown;

export type ChatRunReconnectSchedulerOptions = {
  setTimer(callback: () => void, delayMs: number): ChatRunReconnectTimer;
  clearTimer(timer: ChatRunReconnectTimer): void;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

export type ChatRunReconnectSchedule = {
  scheduled: boolean;
  attempt: number;
  delayMs: number;
};

export type ChatRunReconnectScheduler = {
  schedule(runId: string, reconnect: () => void): ChatRunReconnectSchedule;
  has(runId: string): boolean;
  markProgress(runId: string): void;
  cancel(runId: string): void;
  activate(): void;
  dispose(): void;
};

type ScheduledReconnect = {
  token: object;
  timer: ChatRunReconnectTimer;
  attempt: number;
  delayMs: number;
};

function positiveDelay(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : fallback;
}

export function createChatRunReconnectScheduler(
  options: ChatRunReconnectSchedulerOptions
): ChatRunReconnectScheduler {
  const initialDelayMs = positiveDelay(options.initialDelayMs, 500);
  const maxDelayMs = Math.max(
    initialDelayMs,
    positiveDelay(options.maxDelayMs, 8_000)
  );
  const attempts = new Map<string, number>();
  const scheduled = new Map<string, ScheduledReconnect>();
  let disposed = false;

  const clearScheduled = (runId: string) => {
    const current = scheduled.get(runId);
    if (!current) {
      return;
    }
    scheduled.delete(runId);
    options.clearTimer(current.timer);
  };

  const cancel = (runId: string) => {
    clearScheduled(runId);
    attempts.delete(runId);
  };

  return {
    schedule(runId, reconnect) {
      const normalizedRunId = runId.trim();
      const current = scheduled.get(normalizedRunId);
      if (disposed || !normalizedRunId) {
        return { scheduled: false, attempt: 0, delayMs: 0 };
      }
      if (current) {
        return {
          scheduled: false,
          attempt: current.attempt,
          delayMs: current.delayMs
        };
      }

      const attempt = (attempts.get(normalizedRunId) ?? 0) + 1;
      attempts.set(normalizedRunId, attempt);
      const delayMs = Math.min(
        maxDelayMs,
        initialDelayMs * 2 ** Math.min(attempt - 1, 20)
      );
      const token = {};
      const timer = options.setTimer(() => {
        const active = scheduled.get(normalizedRunId);
        if (disposed || active?.token !== token) {
          return;
        }
        scheduled.delete(normalizedRunId);
        reconnect();
      }, delayMs);
      scheduled.set(normalizedRunId, { token, timer, attempt, delayMs });
      return { scheduled: true, attempt, delayMs };
    },
    has(runId) {
      return scheduled.has(runId.trim());
    },
    markProgress(runId) {
      cancel(runId.trim());
    },
    cancel(runId) {
      cancel(runId.trim());
    },
    activate() {
      disposed = false;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const runId of Array.from(scheduled.keys())) {
        clearScheduled(runId);
      }
      attempts.clear();
    }
  };
}
