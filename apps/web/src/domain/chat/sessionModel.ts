export type {
  ArtifactEdit,
  ArtifactEditReference,
  ArtifactEditRollback,
  ArtifactEditVariant,
  BranchRunRollback,
  BugReportDraft,
  BugReportImage,
  ChatSession,
  ClientMessage,
  SessionFile,
  SessionFileKind,
  SessionState
} from "./sessionTypes";

export {
  createEmptyBugReportDraft,
  isBugReportDraftEmpty,
  MAX_BUG_REPORT_IMAGES,
  MAX_BUG_REPORT_TEXT_LENGTH,
  normalizeBugReportDraft
} from "./bugReportPersistence";

export {
  compactEmptySessions,
  createEmptySession,
  createId,
  createInitialSessionState,
  filterDeletedSessionState,
  getSessionStreamingRunIds,
  hasPersistedMessages,
  initialMessages,
  isSessionEmpty,
  sortSessions,
  STREAM_INTERRUPTED_ERROR,
  UNTITLED_SESSION
} from "./sessionLifecycle";

export { mergeSyncedSessionState } from "./sessionSyncModel";

export {
  assistantMessageToSessionTitle,
  countUserPrompts,
  stripLegacyArtifactActionPrefix,
  summarizeSession,
  titleFromText
} from "./sessionTitleModel";

export { rebuildAssistantSnapshot } from "./messageRenderPersistence";

export {
  interruptStaleArtifactEditsInSessionState,
  STALE_ARTIFACT_EDIT_SWEEP_INTERVAL_MS
} from "./artifactEditPersistence";

export {
  normalizeStoredMessage,
  normalizeStoredSession,
  normalizeStoredSessionState,
  serializeMessage,
  serializeSessions
} from "./storedSessionCodec";
