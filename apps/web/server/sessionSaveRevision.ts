import type { StoredSessionState } from "./sessionStateTypes.js";

const MAX_CLIENT_SAVE_REVISIONS = 512;

export function normalizeSessionSaveClientId(input: unknown): string {
  const value = (typeof input === "string" ? input : "")
    .trim()
    .slice(0, 160)
    .replace(/[^a-z0-9._:-]/gi, "");
  return value.length >= 8 ? value : "";
}

export function normalizeSessionSaveRevision(
  input: unknown
): number | undefined {
  return typeof input === "number" &&
    Number.isSafeInteger(input) &&
    input > 0
    ? input
    : undefined;
}

export function normalizeClientSaveRevisions(
  input: unknown
): Record<string, number> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const revisions = new Map<string, number>();
  for (const [rawClientId, rawRevision] of Object.entries(input)) {
    const clientId = normalizeSessionSaveClientId(rawClientId);
    const revision = normalizeSessionSaveRevision(rawRevision);
    if (!clientId || revision === undefined) {
      continue;
    }
    revisions.delete(clientId);
    revisions.set(clientId, revision);
  }

  const entries = Array.from(revisions.entries()).slice(
    -MAX_CLIENT_SAVE_REVISIONS
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function shouldApplySessionSaveRevision(
  state: StoredSessionState,
  clientId: string,
  saveRevision: number | undefined
): boolean {
  if (!clientId || saveRevision === undefined) {
    return Object.keys(state.clientSaveRevisions ?? {}).length === 0;
  }

  const currentRevision = state.clientSaveRevisions?.[clientId] ?? 0;
  return saveRevision > currentRevision;
}

export function recordSessionSaveRevision(
  state: StoredSessionState,
  clientId: string,
  saveRevision: number | undefined
): StoredSessionState {
  if (!clientId || saveRevision === undefined) {
    return state;
  }

  const entries = Object.entries(state.clientSaveRevisions ?? {}).filter(
    ([storedClientId]) => storedClientId !== clientId
  );
  entries.push([clientId, saveRevision]);
  return {
    ...state,
    clientSaveRevisions: Object.fromEntries(
      entries.slice(-MAX_CLIENT_SAVE_REVISIONS)
    )
  };
}
