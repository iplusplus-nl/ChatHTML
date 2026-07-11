import type { BranchRunRollback } from "./sessionBranchRunLifecycle.js";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: unknown[];
  fileIds?: unknown[];
  reasoning?: string;
  sessionTitle?: string;
  rawStream?: string;
  hasStreamUi?: boolean;
  streamUiComplete?: boolean;
  artifactContext?: unknown;
  runtimeErrors?: unknown[];
  repairOfMessageId?: string;
  repairAttempt?: number;
  branchGroupId?: string;
  branchVariantId?: string;
  branchAnchor?: boolean;
  branchRunRollback?: BranchRunRollback;
  artifactEditBaseRawStream?: string;
  artifactEdits?: unknown[];
  activeArtifactEditId?: string;
  generationRunId?: string;
  streamSequence?: number;
  generationOutcome?: "complete" | "error" | "cancelled";
  status?: "streaming" | "complete" | "error";
  error?: string;
};

export type StoredSessionFile = {
  id: string;
  kind: "image" | "artifact" | "text";
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  sourceMessageId?: string;
  storageKey?: string;
  contentHash?: string;
  accessToken?: string;
  embedUrl?: string;
  downloadUrl?: string;
  draft?: boolean;
  dataUrl?: string;
  text?: string;
  width?: number;
  height?: number;
  summary?: string;
};

export type StoredBugReportImage = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  width?: number;
  height?: number;
  captured?: boolean;
  createdAt: number;
};

export type StoredBugReportDraft = {
  text: string;
  images: StoredBugReportImage[];
  updatedAt: number;
  screenshotCapturedAt?: number;
};

export type StoredSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  branchSelections?: Record<string, string>;
  messages: StoredMessage[];
  files?: StoredSessionFile[];
  bugReportDraft?: StoredBugReportDraft;
};

export type StoredSessionState = {
  sessions: StoredSession[];
  activeSessionId: string;
  deletedSessionIds?: string[];
  clientSaveRevisions?: Record<string, number>;
};

export type SessionMessageInput = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  fileIds?: string[];
  reasoning?: string;
  sessionTitle?: string;
  rawStream?: string;
  hasStreamUi?: boolean;
  streamUiComplete?: boolean;
  artifactContext?: unknown;
  runtimeErrors?: unknown[];
  repairOfMessageId?: string;
  repairAttempt?: number;
  branchGroupId?: string;
  branchVariantId?: string;
  branchAnchor?: boolean;
  branchRunRollback?: BranchRunRollback;
  artifactEditBaseRawStream?: string;
  artifactEdits?: unknown[];
  activeArtifactEditId?: string;
  generationRunId?: string;
  streamSequence?: number;
  generationOutcome?: "complete" | "error" | "cancelled";
  status?: "streaming" | "complete" | "error";
  error?: string;
};

export type SessionMessagePatch = Partial<
  Omit<SessionMessageInput, "id" | "role">
>;

export type SessionMessageSnapshot = Omit<SessionMessageInput, "fileIds"> & {
  fileIds?: unknown[];
};
