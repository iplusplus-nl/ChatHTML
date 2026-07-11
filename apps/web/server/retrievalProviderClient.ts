import { clip } from "./retrievalPrimitives.js";
import { createRetrievalOperationSignal } from "./retrievalAbort.js";
import type { RetrievalConfig } from "./retrievalTypes.js";

export const RETRIEVAL_USER_AGENT =
  "ChatHTML-Retrieval/0.1 (+https://localhost; local development retrieval service)";

export async function fetchRetrievalJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: createRetrievalOperationSignal(timeoutMs, signal)
  });

  if (!response.ok) {
    throw new Error(`Search API returned HTTP ${response.status}.`);
  }

  return response.json();
}

export function retrievalImageProviderLimit(config: RetrievalConfig): number {
  return Math.min(12, Math.max(4, config.searchMaxResults));
}

export function cleanRetrievalImageProviderQuery(query: string): string {
  return (
    clip(
      query
        .replace(/\bsite:\S+/gi, " ")
        .replace(/\b(?:wikimedia commons|openverse|pexels|unsplash)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
      220
    ) || query
  );
}
