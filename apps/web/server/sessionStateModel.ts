import { randomUUID } from "node:crypto";
import {
  compactCancelledBranchRuns,
  normalizeBranchRunRollback
} from "./sessionBranchRunLifecycle.js";
import { normalizeClientSaveRevisions } from "./sessionSaveRevision.js";
import type {
  SessionMessageInput,
  SessionMessagePatch,
  SessionMessageSnapshot,
  StoredBugReportDraft,
  StoredBugReportImage,
  StoredMessage,
  StoredSession,
  StoredSessionFile,
  StoredSessionState
} from "./sessionStateTypes.js";

const MAX_DELETED_SESSION_TOMBSTONES = 5000;
const MAX_BUG_REPORT_IMAGES = 8;
const MAX_BUG_REPORT_TEXT_LENGTH = 12_000;
const MAX_BUG_REPORT_IMAGE_DATA_URL_CHARS = 20_000_000;
const BUG_REPORT_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

const SESSION_MESSAGE_PATCH_KEYS: Array<keyof SessionMessagePatch> = [
  "content",
  "fileIds",
  "reasoning",
  "sessionTitle",
  "rawStream",
  "hasStreamUi",
  "streamUiComplete",
  "artifactContext",
  "runtimeErrors",
  "repairOfMessageId",
  "repairAttempt",
  "branchGroupId",
  "branchVariantId",
  "branchAnchor",
  "branchRunRollback",
  "artifactEditBaseRawStream",
  "artifactEdits",
  "activeArtifactEditId",
  "generationRunId",
  "streamSequence",
  "generationOutcome",
  "status",
  "error"
];

export function sessionStateNow(): number {
  return Date.now();
}

function createId(prefix: string): string {
  return `${prefix}-${sessionStateNow()}-${randomUUID().slice(0, 8)}`;
}

export function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createEmptySessionState(
  deletedSessionIds: string[] = []
): StoredSessionState {
  const timestamp = sessionStateNow();
  const session: StoredSession = {
    id: createId("session"),
    title: "New Session",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    files: []
  };

  return {
    sessions: [session],
    activeSessionId: session.id,
    deletedSessionIds
  };
}

function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of input) {
    const value = stringValue(item).trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }

  return values.length ? values : undefined;
}

function normalizeArtifactEdits(input: unknown): unknown[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const edits = input.filter(
    (item) => item && typeof item === "object" && !Array.isArray(item)
  );
  return edits.length ? edits : undefined;
}

function normalizeBranchSelections(
  input: unknown
): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const selections: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim().slice(0, 160);
    const value = typeof rawValue === "string" ? rawValue.trim().slice(0, 160) : "";
    if (key && value) {
      selections[key] = value;
    }
  }

  return Object.keys(selections).length ? selections : undefined;
}

function normalizeBugReportImage(input: unknown): StoredBugReportImage | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const image = input as Partial<StoredBugReportImage>;
  const id = stringValue(image.id).trim();
  const name = stringValue(image.name).trim();
  const mimeType = stringValue(image.mimeType).trim().toLowerCase();
  const dataUrl = stringValue(image.dataUrl).trim();

  if (
    !id ||
    !name ||
    !BUG_REPORT_IMAGE_MIME_TYPES.has(mimeType) ||
    !dataUrl.startsWith(`data:${mimeType};base64,`) ||
    dataUrl.length > MAX_BUG_REPORT_IMAGE_DATA_URL_CHARS
  ) {
    return null;
  }

  return {
    id: id.slice(0, 160),
    name: name.slice(0, 180),
    mimeType,
    size:
      typeof image.size === "number" && Number.isFinite(image.size)
        ? Math.max(0, Math.round(image.size))
        : 0,
    dataUrl,
    width:
      typeof image.width === "number" && Number.isFinite(image.width)
        ? Math.max(1, Math.round(image.width))
        : undefined,
    height:
      typeof image.height === "number" && Number.isFinite(image.height)
        ? Math.max(1, Math.round(image.height))
        : undefined,
    captured: image.captured ? true : undefined,
    createdAt: finiteTimestamp(image.createdAt, sessionStateNow())
  };
}

function normalizeBugReportDraft(input: unknown): StoredBugReportDraft | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const draft = input as Partial<StoredBugReportDraft>;
  const seen = new Set<string>();
  const images: StoredBugReportImage[] = [];
  if (Array.isArray(draft.images)) {
    for (const item of draft.images) {
      const image = normalizeBugReportImage(item);
      if (!image || seen.has(image.id)) {
        continue;
      }
      seen.add(image.id);
      images.push(image);
      if (images.length >= MAX_BUG_REPORT_IMAGES) {
        break;
      }
    }
  }

  const text = stringValue(draft.text).slice(0, MAX_BUG_REPORT_TEXT_LENGTH);
  const screenshotCapturedAt =
    typeof draft.screenshotCapturedAt === "number" &&
    Number.isFinite(draft.screenshotCapturedAt)
      ? draft.screenshotCapturedAt
      : undefined;

  if (!text.trim() && images.length === 0 && !screenshotCapturedAt) {
    return undefined;
  }

  return {
    text,
    images,
    updatedAt: finiteTimestamp(draft.updatedAt, sessionStateNow()),
    screenshotCapturedAt
  };
}

export function normalizeDeletedSessionIdList(input: unknown): string[] {
  const ids = normalizeStringArray(input);
  return (ids ?? []).slice(-MAX_DELETED_SESSION_TOMBSTONES);
}

export function normalizeDeletedSessionIds(input: unknown): Set<string> {
  return new Set(normalizeDeletedSessionIdList(input));
}

export function mergeDeletedSessionIdLists(...inputs: unknown[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const input of inputs) {
    for (const id of normalizeDeletedSessionIdList(input)) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      values.push(id);
    }
  }

  return values.slice(-MAX_DELETED_SESSION_TOMBSTONES);
}

function normalizeSessionFile(input: unknown): StoredSessionFile | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const file = input as Partial<StoredSessionFile>;
  const kind =
    file.kind === "image" || file.kind === "artifact" || file.kind === "text"
      ? file.kind
      : null;
  const id = stringValue(file.id).trim();
  const name = stringValue(file.name).trim();
  if (!kind || !id || !name) {
    return null;
  }

  const dataUrl = stringValue(file.dataUrl);
  const text = stringValue(file.text);
  const storageKey = stringValue(file.storageKey);
  const accessToken = stringValue(file.accessToken);
  if (kind === "image" && !dataUrl && !storageKey) {
    return null;
  }
  if ((kind === "artifact" || kind === "text") && !text && !storageKey) {
    return null;
  }

  return {
    id,
    kind,
    name: name.slice(0, 180),
    mimeType: stringValue(file.mimeType, kind === "image" ? "image/png" : "text/plain")
      .trim()
      .slice(0, 120),
    size:
      typeof file.size === "number" && Number.isFinite(file.size)
        ? Math.max(0, Math.round(file.size))
        : text.length,
    createdAt: finiteTimestamp(file.createdAt, sessionStateNow()),
    sourceMessageId: stringValue(file.sourceMessageId) || undefined,
    storageKey: storageKey || undefined,
    contentHash: stringValue(file.contentHash) || undefined,
    accessToken: accessToken || undefined,
    embedUrl: stringValue(file.embedUrl) || undefined,
    downloadUrl: stringValue(file.downloadUrl) || undefined,
    draft: Boolean(file.draft),
    dataUrl: dataUrl || undefined,
    text: text || undefined,
    width:
      typeof file.width === "number" && Number.isFinite(file.width)
        ? Math.max(1, Math.round(file.width))
        : undefined,
    height:
      typeof file.height === "number" && Number.isFinite(file.height)
        ? Math.max(1, Math.round(file.height))
        : undefined,
    summary: stringValue(file.summary).slice(0, 1_200) || undefined
  };
}

function normalizeSessionFiles(input: unknown): StoredSessionFile[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const files: StoredSessionFile[] = [];
  for (const item of input) {
    const file = normalizeSessionFile(item);
    if (!file || seen.has(file.id)) {
      continue;
    }
    seen.add(file.id);
    files.push(file);
  }

  return files;
}

export function normalizeStoredMessage(input: unknown): StoredMessage | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const message = input as Partial<StoredMessage>;
  if (
    typeof message.id !== "string" ||
    (message.role !== "user" && message.role !== "assistant")
  ) {
    return null;
  }

  const status =
    message.role === "assistant"
      ? message.status === "streaming" ||
        message.status === "complete" ||
        message.status === "error"
        ? message.status
        : "complete"
      : undefined;

  return {
    id: message.id,
    role: message.role,
    content: stringValue(message.content),
    attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
    fileIds: normalizeStringArray(message.fileIds),
    reasoning: stringValue(message.reasoning) || undefined,
    sessionTitle: stringValue(message.sessionTitle) || undefined,
    rawStream: stringValue(message.rawStream) || undefined,
    hasStreamUi: Boolean(message.hasStreamUi),
    streamUiComplete: Boolean(message.streamUiComplete),
    artifactContext:
      message.artifactContext && typeof message.artifactContext === "object"
        ? message.artifactContext
        : undefined,
    runtimeErrors: Array.isArray(message.runtimeErrors)
      ? message.runtimeErrors
      : undefined,
    repairOfMessageId: stringValue(message.repairOfMessageId) || undefined,
    repairAttempt:
      typeof message.repairAttempt === "number" && Number.isFinite(message.repairAttempt)
        ? Math.max(1, Math.round(message.repairAttempt))
        : undefined,
    branchGroupId: stringValue(message.branchGroupId) || undefined,
    branchVariantId: stringValue(message.branchVariantId) || undefined,
    branchAnchor: message.branchAnchor ? true : undefined,
    branchRunRollback: normalizeBranchRunRollback(message.branchRunRollback),
    artifactEditBaseRawStream:
      typeof message.artifactEditBaseRawStream === "string"
        ? message.artifactEditBaseRawStream
        : undefined,
    artifactEdits: normalizeArtifactEdits(message.artifactEdits),
    activeArtifactEditId: stringValue(message.activeArtifactEditId) || undefined,
    generationRunId: stringValue(message.generationRunId) || undefined,
    streamSequence:
      typeof message.streamSequence === "number" &&
      Number.isFinite(message.streamSequence)
        ? Math.max(0, Math.round(message.streamSequence))
        : undefined,
    generationOutcome:
      message.generationOutcome === "complete" ||
      message.generationOutcome === "error" ||
      message.generationOutcome === "cancelled"
        ? message.generationOutcome
        : undefined,
    status,
    error: stringValue(message.error) || undefined
  };
}

function normalizeStoredSession(input: unknown): StoredSession | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const session = input as Partial<StoredSession>;
  if (typeof session.id !== "string") {
    return null;
  }

  const timestamp = sessionStateNow();
  const createdAt = finiteTimestamp(session.createdAt, timestamp);
  const updatedAt = finiteTimestamp(session.updatedAt, createdAt);
  const messages = Array.isArray(session.messages)
    ? session.messages
        .map(normalizeStoredMessage)
        .filter((message): message is StoredMessage => message !== null)
    : [];

  return compactCancelledBranchRuns({
    id: session.id,
    title: stringValue(session.title, "New Session").trim() || "New Session",
    createdAt,
    updatedAt,
    model: stringValue(session.model).trim().slice(0, 180) || undefined,
    branchSelections: normalizeBranchSelections(session.branchSelections),
    messages,
    files: normalizeSessionFiles(session.files),
    bugReportDraft: normalizeBugReportDraft(session.bugReportDraft)
  });
}

function hasCommittedSessionFiles(session: StoredSession): boolean {
  return Boolean((session.files ?? []).some((file) => !file.draft));
}

export function hasDraftSessionFiles(session: StoredSession): boolean {
  return Boolean((session.files ?? []).some((file) => file.draft));
}

export function isStoredSessionEmpty(session: StoredSession): boolean {
  return (
    session.messages.length === 0 &&
    !hasCommittedSessionFiles(session) &&
    !session.bugReportDraft?.text.trim() &&
    !session.bugReportDraft?.images.length
  );
}

export function compactEmptyStoredSessions(
  sessions: StoredSession[],
  activeSessionId: string
): { sessions: StoredSession[]; activeSessionId: string } {
  const nonEmptySessions = sessions.filter((session) => !isStoredSessionEmpty(session));
  const compactedSessions = nonEmptySessions.length ? nonEmptySessions : sessions.slice(0, 1);
  const compactedActiveSessionId = compactedSessions.some(
    (session) => session.id === activeSessionId
  )
    ? activeSessionId
    : compactedSessions[0]?.id ?? activeSessionId;

  return {
    sessions: compactedSessions,
    activeSessionId: compactedActiveSessionId
  };
}

export function normalizeStoredSessionState(input: unknown): StoredSessionState {
  if (!input || typeof input !== "object") {
    return createEmptySessionState();
  }

  const state = input as Partial<StoredSessionState>;
  const deletedSessionIds = normalizeDeletedSessionIdList(state.deletedSessionIds);
  const clientSaveRevisions = normalizeClientSaveRevisions(
    state.clientSaveRevisions
  );
  const deletedSessionIdSet = new Set(deletedSessionIds);
  const sessions = Array.isArray(state.sessions)
    ? state.sessions
        .map(normalizeStoredSession)
        .filter((session): session is StoredSession => session !== null)
        .filter((session) => !deletedSessionIdSet.has(session.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    : [];

  if (!sessions.length) {
    return {
      ...createEmptySessionState(deletedSessionIds),
      ...(clientSaveRevisions ? { clientSaveRevisions } : {})
    };
  }

  const requestedActiveId =
    typeof state.activeSessionId === "string" ? state.activeSessionId : "";
  const activeSessionId = sessions.some((session) => session.id === requestedActiveId)
    ? requestedActiveId
    : sessions[0].id;

  return {
    sessions,
    activeSessionId,
    deletedSessionIds,
    ...(clientSaveRevisions ? { clientSaveRevisions } : {})
  };
}

export function selectPresentSessionMessagePatch(
  input: SessionMessageInput,
  normalized: SessionMessageSnapshot
): SessionMessagePatch {
  const patch: SessionMessagePatch = {};
  for (const key of SESSION_MESSAGE_PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue;
    }
    Object.assign(patch, { [key]: normalized[key] });
  }
  return patch;
}

export function findStoredSession(
  state: StoredSessionState,
  sessionId: string
): StoredSession | undefined {
  return state.sessions.find((session) => session.id === sessionId);
}

export function ensureStoredSession(
  state: StoredSessionState,
  sessionId: string
): StoredSession {
  const existing = findStoredSession(state, sessionId);
  if (existing) {
    existing.files = existing.files ?? [];
    return existing;
  }

  const timestamp = sessionStateNow();
  const session: StoredSession = {
    id: sessionId,
    title: "New Session",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    files: []
  };
  state.sessions.unshift(session);
  state.activeSessionId = sessionId;
  return session;
}

export function isStoredSessionDeleted(
  state: StoredSessionState,
  sessionId: string
): boolean {
  return Boolean(state.deletedSessionIds?.includes(sessionId));
}

export function mergeStoredSessionFiles(
  current: StoredSessionFile[] | undefined,
  incoming: StoredSessionFile[] | undefined
): StoredSessionFile[] {
  const files = new Map<string, StoredSessionFile>();
  for (const file of current ?? []) {
    files.set(file.id, file);
  }
  for (const file of incoming ?? []) {
    files.set(file.id, file);
  }
  return Array.from(files.values()).sort((a, b) => a.createdAt - b.createdAt);
}

export function mergeStoredMessage(
  current: StoredMessage,
  patch: Partial<StoredMessage>
): StoredMessage {
  return (
    normalizeStoredMessage({
      ...current,
      ...patch,
      id: current.id,
      role: current.role,
      content: Object.prototype.hasOwnProperty.call(patch, "content")
        ? patch.content
        : current.content
    }) ?? current
  );
}

export function upsertStoredMessages(
  session: StoredSession,
  inputs: SessionMessageInput[]
): void {
  for (const input of inputs) {
    const message = normalizeStoredMessage(input);
    if (!message) {
      continue;
    }

    const index = session.messages.findIndex((candidate) => candidate.id === message.id);
    if (index >= 0) {
      session.messages[index] = mergeStoredMessage(
        session.messages[index],
        selectPresentSessionMessagePatch(input, message)
      );
    } else {
      session.messages.push(message);
    }
  }
}
