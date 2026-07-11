import {
  normalizeUiComplexity,
  type ReasoningEffort
} from "../../core/apiSettings";
import { extractStreamUiParts } from "../../runtime/streamui/protocol";
import {
  interruptStaleArtifactEditsInMessage,
  normalizeArtifactEdits
} from "./artifactEditPersistence";
import { compactCancelledBranchRuns } from "./branchRunLifecycle";
import { normalizeBugReportDraft } from "./bugReportPersistence";
import { migrateLegacyGeneratedArtifactBatch } from "./generatedArtifactMigration";
import {
  normalizeArtifactContext,
  normalizeRenderErrors,
  rebuildAssistantSnapshot
} from "./messageRenderPersistence";
import {
  migrateMessageFiles,
  normalizeSessionFiles
} from "./sessionFileMigration";
import {
  compactEmptySessions,
  createInitialSessionState,
  sortSessions,
  UNTITLED_SESSION
} from "./sessionLifecycle";
import {
  stripLegacyArtifactActionPrefix,
  summarizeSession
} from "./sessionTitleModel";
import type {
  ChatSession,
  ClientMessage,
  NormalizeStoredSessionOptions,
  SessionState
} from "./sessionTypes";

function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") {
      continue;
    }
    const value = item.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }

  return values.length ? values : undefined;
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
    const value =
      typeof rawValue === "string" ? rawValue.trim().slice(0, 160) : "";
    if (key && value) {
      selections[key] = value;
    }
  }

  return Object.keys(selections).length ? selections : undefined;
}

function normalizeSessionReasoningEffort(
  input: unknown
): ReasoningEffort | undefined {
  return input === "none" ||
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high" ||
    input === "xhigh"
    ? input
    : undefined;
}

export function normalizeStoredMessage(
  message: unknown,
  options: NormalizeStoredSessionOptions = {}
): ClientMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const input = message as Partial<ClientMessage>;
  if (
    typeof input.id !== "string" ||
    (input.role !== "user" && input.role !== "assistant")
  ) {
    return null;
  }

  const rawStream =
    typeof input.rawStream === "string" ? input.rawStream : undefined;
  const streamParts =
    rawStream && options.rebuildSnapshots === false
      ? extractStreamUiParts(rawStream)
      : null;
  const normalized: ClientMessage = {
    id: input.id,
    role: input.role,
    content:
      input.role === "user" && typeof input.content === "string"
        ? stripLegacyArtifactActionPrefix(input.content)
        : typeof input.content === "string"
          ? input.content
          : "",
    attachments: Array.isArray(input.attachments) ? input.attachments : undefined,
    fileIds: normalizeStringArray(input.fileIds),
    reasoning: typeof input.reasoning === "string" ? input.reasoning : undefined,
    sessionTitle:
      typeof input.sessionTitle === "string" ? input.sessionTitle : undefined,
    rawStream,
    hasStreamUi: Boolean(input.hasStreamUi || streamParts?.hasStreamUi),
    streamUiComplete: Boolean(
      input.streamUiComplete || streamParts?.streamUiComplete
    ),
    artifactContext: normalizeArtifactContext(input.artifactContext),
    runtimeErrors: normalizeRenderErrors(input.runtimeErrors),
    repairOfMessageId:
      typeof input.repairOfMessageId === "string"
        ? input.repairOfMessageId
        : undefined,
    repairAttempt:
      typeof input.repairAttempt === "number" && Number.isFinite(input.repairAttempt)
        ? Math.max(1, Math.round(input.repairAttempt))
        : undefined,
    branchGroupId:
      typeof input.branchGroupId === "string" && input.branchGroupId.trim()
        ? input.branchGroupId.trim().slice(0, 160)
        : undefined,
    branchVariantId:
      typeof input.branchVariantId === "string" && input.branchVariantId.trim()
        ? input.branchVariantId.trim().slice(0, 160)
        : undefined,
    branchAnchor: input.branchAnchor ? true : undefined,
    branchRunRollback:
      input.branchRunRollback &&
      typeof input.branchRunRollback === "object" &&
      typeof input.branchRunRollback.runId === "string" &&
      input.branchRunRollback.runId.trim() &&
      typeof input.branchRunRollback.groupId === "string" &&
      input.branchRunRollback.groupId.trim() &&
      typeof input.branchRunRollback.variantId === "string" &&
      input.branchRunRollback.variantId.trim()
        ? {
            runId: input.branchRunRollback.runId.trim().slice(0, 160),
            groupId: input.branchRunRollback.groupId.trim().slice(0, 160),
            variantId: input.branchRunRollback.variantId.trim().slice(0, 160),
            fallbackVariantId:
              typeof input.branchRunRollback.fallbackVariantId === "string" &&
              input.branchRunRollback.fallbackVariantId.trim()
                ? input.branchRunRollback.fallbackVariantId
                    .trim()
                    .slice(0, 160)
                : undefined
          }
        : undefined,
    artifactEditBaseRawStream:
      typeof input.artifactEditBaseRawStream === "string"
        ? input.artifactEditBaseRawStream
        : undefined,
    artifactEdits: normalizeArtifactEdits(input.artifactEdits, false),
    activeArtifactEditId:
      typeof input.activeArtifactEditId === "string" &&
      input.activeArtifactEditId.trim()
        ? input.activeArtifactEditId.trim().slice(0, 160)
        : undefined,
    generationRunId:
      typeof input.generationRunId === "string" && input.generationRunId.trim()
        ? input.generationRunId.trim()
        : undefined,
    streamSequence:
      typeof input.streamSequence === "number" && Number.isFinite(input.streamSequence)
        ? Math.max(0, Math.round(input.streamSequence))
        : undefined,
    generationOutcome:
      input.generationOutcome === "complete" ||
      input.generationOutcome === "error" ||
      input.generationOutcome === "cancelled"
        ? input.generationOutcome
        : undefined,
    status:
      input.status === "streaming" ||
      input.status === "complete" ||
      input.status === "error"
        ? input.status
        : input.role === "assistant"
          ? "complete"
          : undefined,
    error: typeof input.error === "string" ? input.error : undefined
  };

  if (
    normalized.role === "assistant" &&
    normalized.status === "streaming" &&
    !normalized.generationRunId
  ) {
    normalized.status = "complete";
  }

  const migrated = migrateLegacyGeneratedArtifactBatch(normalized);
  const restored = options.interruptPendingArtifactEdits
    ? interruptStaleArtifactEditsInMessage(migrated)
    : migrated;

  return options.rebuildSnapshots === false
    ? restored
    : rebuildAssistantSnapshot(restored);
}

export function normalizeStoredSession(
  session: unknown,
  now = Date.now(),
  options: NormalizeStoredSessionOptions = {}
): ChatSession | null {
  if (!session || typeof session !== "object") {
    return null;
  }

  const input = session as Partial<ChatSession>;
  if (typeof input.id !== "string") {
    return null;
  }

  const messages = Array.isArray(input.messages)
    ? input.messages
        .map((message) => normalizeStoredMessage(message, options))
        .filter((message): message is ClientMessage => message !== null)
    : [];
  const migrated = migrateMessageFiles(
    messages,
    normalizeSessionFiles(input.files, now),
    now
  );
  const createdAt =
    typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
      ? input.createdAt
      : now;
  const updatedAt =
    typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
      ? input.updatedAt
      : createdAt;
  const normalizedSession: ChatSession = {
    id: input.id,
    title:
      summarizeSession(migrated.messages) !== UNTITLED_SESSION
        ? summarizeSession(migrated.messages)
        : typeof input.title === "string" && input.title.trim()
          ? input.title.trim()
          : UNTITLED_SESSION,
    createdAt,
    updatedAt,
    model:
      typeof input.model === "string" && input.model.trim()
        ? input.model.trim().slice(0, 180)
        : undefined,
    reasoningEffort: normalizeSessionReasoningEffort(input.reasoningEffort),
    uiComplexity: Object.prototype.hasOwnProperty.call(input, "uiComplexity")
      ? normalizeUiComplexity(input.uiComplexity)
      : undefined,
    branchSelections: normalizeBranchSelections(input.branchSelections),
    messages: migrated.messages,
    files: migrated.files,
    bugReportDraft: normalizeBugReportDraft(input.bugReportDraft, now)
  };
  const compacted = compactCancelledBranchRuns(normalizedSession);
  const summarizedTitle = summarizeSession(compacted.messages);
  return summarizedTitle !== UNTITLED_SESSION && summarizedTitle !== compacted.title
    ? { ...compacted, title: summarizedTitle }
    : compacted;
}

export function normalizeStoredSessionState(
  input: unknown,
  now = Date.now(),
  options: NormalizeStoredSessionOptions = {}
): SessionState {
  if (!input || typeof input !== "object") {
    return createInitialSessionState(now);
  }

  const state = input as Partial<SessionState>;
  const sessions = Array.isArray(state.sessions)
    ? state.sessions
        .map((session) => normalizeStoredSession(session, now, options))
        .filter((session): session is ChatSession => session !== null)
    : [];

  if (!sessions.length) {
    return createInitialSessionState(now);
  }

  const sorted = sortSessions(sessions);
  const activeSessionId =
    typeof state.activeSessionId === "string" &&
    sorted.some((session) => session.id === state.activeSessionId)
      ? state.activeSessionId
      : sorted[0].id;

  return compactEmptySessions({
    sessions: sorted,
    activeSessionId
  });
}

export function serializeMessage(
  message: ClientMessage
): Omit<ClientMessage, "snapshot"> {
  const {
    snapshot: _snapshot,
    attachments: _attachments,
    ...serializable
  } = message;

  return {
    ...serializable
  };
}

export function serializeSessions(sessions: ChatSession[]) {
  return sessions.map((session) => ({
    ...session,
    messages: session.messages.map(serializeMessage)
  }));
}
