import {
  compactEmptySessions,
  isSessionEmpty,
  normalizeStoredSession,
  serializeSessions,
  sortSessions,
  summarizeSession,
  type ChatSession,
  type SessionState
} from "../../domain/chat/sessionModel";

const LEGACY_SESSION_STORAGE_KEY = "streamui.sessions.v1";
const LEGACY_ACTIVE_SESSION_STORAGE_KEY = "streamui.activeSession.v1";
const SESSION_CLIENT_ID_STORAGE_KEY = "streamui.clientId.v1";
const SESSION_INDEX_CACHE_KEY = "streamui.sessionIndex.v1";
const SESSION_SAVE_REVISION_STORAGE_PREFIX = "streamui.sessionSaveRevision.v1:";

const lastSessionSaveRevisionByClientId = new Map<string, number>();

export type SessionListPreview = {
  activeSessionId: string;
  sessions: Array<{ id: string; title: string }>;
};

export type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserLocalStorage(): SessionStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeSessionSaveRevision(input: unknown): number | undefined {
  return typeof input === "number" &&
    Number.isSafeInteger(input) &&
    input > 0
    ? input
    : undefined;
}

function readStoredSessionSaveRevision(
  storage: SessionStorage | undefined,
  storageKey: string
): number {
  if (!storage) {
    return 0;
  }

  try {
    return normalizeSessionSaveRevision(Number(storage.getItem(storageKey))) ?? 0;
  } catch {
    return 0;
  }
}

export function advanceSessionSaveRevisionFloor(
  clientId: string,
  saveRevision: unknown,
  storage: SessionStorage | undefined = browserLocalStorage()
): void {
  const revision = normalizeSessionSaveRevision(saveRevision);
  if (revision === undefined) {
    return;
  }

  const storageKey = `${SESSION_SAVE_REVISION_STORAGE_PREFIX}${clientId}`;
  const floor = Math.max(
    revision,
    lastSessionSaveRevisionByClientId.get(clientId) ?? 0,
    readStoredSessionSaveRevision(storage, storageKey)
  );
  lastSessionSaveRevisionByClientId.set(clientId, floor);
  if (storage) {
    try {
      storage.setItem(storageKey, String(floor));
    } catch {
      // Saving sessions must still work when browser storage is unavailable.
    }
  }
}

export function nextSessionSaveRevision(
  clientId: string,
  storage: SessionStorage | undefined = browserLocalStorage(),
  now: () => number = Date.now
): number {
  const storageKey = `${SESSION_SAVE_REVISION_STORAGE_PREFIX}${clientId}`;
  const storedRevision = readStoredSessionSaveRevision(storage, storageKey);

  const inMemoryRevision = lastSessionSaveRevisionByClientId.get(clientId) ?? 0;
  const currentRevision = Math.max(storedRevision, inMemoryRevision);
  const timestamp = now();
  const timestampFloor = Number.isFinite(timestamp)
    ? Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(1, Math.floor(timestamp) * 1_000)
      )
    : 1;
  const incrementedRevision =
    currentRevision < Number.MAX_SAFE_INTEGER
      ? currentRevision + 1
      : Number.MAX_SAFE_INTEGER;
  const revision = Math.max(timestampFloor, incrementedRevision);

  advanceSessionSaveRevisionFloor(clientId, revision, storage);

  return revision;
}

export function normalizeSessionListPreview(
  input: unknown
): SessionListPreview | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const state = input as {
    activeSessionId?: unknown;
    sessions?: unknown;
  };
  if (!Array.isArray(state.sessions)) {
    return null;
  }

  const seen = new Set<string>();
  const sessions: SessionListPreview["sessions"] = [];
  for (const item of state.sessions) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const session = item as { id?: unknown; title?: unknown };
    const id = typeof session.id === "string" ? session.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    sessions.push({
      id,
      title:
        typeof session.title === "string" && session.title.trim()
          ? session.title.trim()
          : "New Session"
    });
  }

  if (!sessions.length) {
    return null;
  }

  const requestedActiveId =
    typeof state.activeSessionId === "string" ? state.activeSessionId : "";
  const activeSessionId = sessions.some(
    (session) => session.id === requestedActiveId
  )
    ? requestedActiveId
    : sessions[0].id;

  return {
    activeSessionId,
    sessions
  };
}

export function sessionListPreviewFromState(
  state: SessionState
): SessionListPreview | null {
  const sessions = state.sessions
    .filter((session) => !isSessionEmpty(session))
    .map((session) => ({
      id: session.id,
      title: session.title || summarizeSession(session.messages)
    }));

  if (!sessions.length) {
    return null;
  }

  const activeSessionId = sessions.some(
    (session) => session.id === state.activeSessionId
  )
    ? state.activeSessionId
    : sessions[0].id;

  return {
    activeSessionId,
    sessions
  };
}

export function loadCachedSessionListPreview(
  storage: SessionStorage | undefined = browserLocalStorage()
): SessionListPreview | null {
  if (!storage) {
    return null;
  }

  try {
    return normalizeSessionListPreview(
      JSON.parse(storage.getItem(SESSION_INDEX_CACHE_KEY) ?? "null")
    );
  } catch {
    return null;
  }
}

export function saveCachedSessionListPreview(
  preview: SessionListPreview | null,
  storage: SessionStorage | undefined = browserLocalStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    if (!preview) {
      storage.removeItem(SESSION_INDEX_CACHE_KEY);
      return;
    }

    storage.setItem(SESSION_INDEX_CACHE_KEY, JSON.stringify(preview));
  } catch {
    // Sidebar cache is only a startup hint.
  }
}

export function createSessionClientId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `client-${random}`;
}

export function loadSessionClientId(
  storage: SessionStorage | undefined = browserLocalStorage(),
  createId: () => string = createSessionClientId
): string {
  if (!storage) {
    return createId();
  }

  const existing = storage.getItem(SESSION_CLIENT_ID_STORAGE_KEY)?.trim();
  if (existing) {
    return existing;
  }

  const clientId = createId();
  storage.setItem(SESSION_CLIENT_ID_STORAGE_KEY, clientId);
  return clientId;
}

export function serializeSessionStateForSave(
  state: SessionState,
  clientId: string,
  deletedSessionIds: string[] = [],
  saveRevision?: number
): string {
  const compactedState = compactEmptySessions(state);

  return JSON.stringify({
    clientId,
    ...(normalizeSessionSaveRevision(saveRevision) !== undefined
      ? { saveRevision }
      : {}),
    deletedSessionIds,
    sessions: serializeSessions(compactedState.sessions),
    activeSessionId: compactedState.activeSessionId
  });
}

export function loadLegacyLocalSessionState(
  storage: SessionStorage | undefined = browserLocalStorage()
): SessionState | null {
  if (!storage) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      storage.getItem(LEGACY_SESSION_STORAGE_KEY) ?? "[]"
    ) as unknown;
    const sessions = Array.isArray(parsed)
      ? parsed
          .map((session) => normalizeStoredSession(session))
          .filter((session): session is ChatSession => session !== null)
      : [];

    if (!sessions.length) {
      return null;
    }

    const sorted = sortSessions(sessions);
    const storedActiveId = storage.getItem(LEGACY_ACTIVE_SESSION_STORAGE_KEY);
    const activeSessionId = sorted.some((session) => session.id === storedActiveId)
      ? storedActiveId ?? sorted[0].id
      : sorted[0].id;

    return { sessions: sorted, activeSessionId };
  } catch {
    return null;
  }
}

export function clearLegacyLocalSessions(
  storage: SessionStorage | undefined = browserLocalStorage()
): void {
  if (!storage) {
    return;
  }

  storage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  storage.removeItem(LEGACY_ACTIVE_SESSION_STORAGE_KEY);
}
