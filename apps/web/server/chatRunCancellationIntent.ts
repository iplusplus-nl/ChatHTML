export const CHAT_RUN_CANCELLATION_INTENT_TTL_MS = 30_000;
export const CHAT_RUN_CANCELLATION_INTENT_CAPACITY = 1_024;

export type ChatRunCancellationIntentRegistry = {
  register(runId: string): boolean;
  consume(runId: string): boolean;
  has(runId: string): boolean;
  size(): number;
};

export function createChatRunCancellationIntentRegistry({
  ttlMs = CHAT_RUN_CANCELLATION_INTENT_TTL_MS,
  capacity = CHAT_RUN_CANCELLATION_INTENT_CAPACITY,
  now = Date.now
}: {
  ttlMs?: number;
  capacity?: number;
  now?: () => number;
} = {}): ChatRunCancellationIntentRegistry {
  const effectiveTtlMs =
    Number.isFinite(ttlMs) && ttlMs > 0
      ? Math.max(1, Math.round(ttlMs))
      : CHAT_RUN_CANCELLATION_INTENT_TTL_MS;
  const effectiveCapacity =
    Number.isFinite(capacity) && capacity > 0
      ? Math.max(1, Math.round(capacity))
      : CHAT_RUN_CANCELLATION_INTENT_CAPACITY;
  const intents = new Map<string, number>();

  const pruneExpired = (currentTime: number): void => {
    for (const [runId, expiresAt] of intents) {
      if (expiresAt > currentTime) {
        continue;
      }
      intents.delete(runId);
    }
  };

  const validRunId = (runId: string): boolean =>
    Boolean(runId) && runId.length <= 160;

  return {
    register(runId) {
      if (!validRunId(runId)) {
        return false;
      }

      const currentTime = now();
      pruneExpired(currentTime);
      const existing = intents.delete(runId);
      while (!existing && intents.size >= effectiveCapacity) {
        const oldestRunId = intents.keys().next().value;
        if (typeof oldestRunId !== "string") {
          break;
        }
        intents.delete(oldestRunId);
      }
      intents.set(runId, currentTime + effectiveTtlMs);
      return !existing;
    },

    consume(runId) {
      const currentTime = now();
      pruneExpired(currentTime);
      return intents.delete(runId);
    },

    has(runId) {
      pruneExpired(now());
      return intents.has(runId);
    },

    size() {
      pruneExpired(now());
      return intents.size;
    }
  };
}

export async function executeAcceptedChatRun({
  preCancelled,
  persistInitial,
  persistCancelled,
  executeProvider
}: {
  preCancelled: boolean;
  persistInitial(): void | Promise<void>;
  persistCancelled(): void | Promise<void>;
  executeProvider(): void | Promise<void>;
}): Promise<"cancelled" | "provider-executed"> {
  if (preCancelled) {
    try {
      await persistInitial();
    } finally {
      await persistCancelled();
    }
    return "cancelled";
  }

  await persistInitial();
  await executeProvider();
  return "provider-executed";
}
