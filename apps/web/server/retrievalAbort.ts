function createAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(
    typeof reason === "string" && reason.trim()
      ? reason
      : "Retrieval was cancelled."
  );
  error.name = "AbortError";
  return error;
}

export function throwIfRetrievalAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal.reason);
  }
}

export function rethrowIfRetrievalAborted(
  error: unknown,
  signal?: AbortSignal
): void {
  throwIfRetrievalAborted(signal);
  if (error instanceof Error && error.name === "AbortError") {
    throw error;
  }
}

export function createRetrievalOperationSignal(
  timeoutMs: number,
  signal?: AbortSignal
): AbortSignal {
  throwIfRetrievalAborted(signal);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
