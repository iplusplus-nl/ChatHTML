import type { ReasoningEffort } from "../../core/apiSettings";
import type { ArtifactContext } from "../../core/artifactContext";
import type { ImageAttachment } from "../../core/imageAttachments";
import type {
  RenderError,
  RenderSnapshot
} from "../../runtime/streamui/types";

export type ArtifactEditReference = {
  kind: "element" | "text";
  key: string;
  selector: string;
  label: string;
  preview: string;
  tagName?: string;
  text?: string;
  html?: string;
};

export type ArtifactEditVariant = {
  id: string;
  operationId?: string;
  createdAt: number;
  status: "pending" | "complete" | "error";
  rawStream?: string;
  summary?: string;
  error?: string;
  editCount?: number;
};

export type ArtifactEditRollback = {
  reasoning?: string;
  sessionTitle?: string;
  repairOfMessageId?: string;
  repairAttempt?: number;
};

export type ArtifactEdit = {
  id: string;
  origin?: "chat-run";
  parentId?: string;
  createdAt: number;
  prompt: string;
  references: ArtifactEditReference[];
  promptBubble?: boolean;
  activeVariantId?: string;
  variants: ArtifactEditVariant[];
  status: "pending" | "complete" | "error";
  error?: string;
  rollback?: ArtifactEditRollback;
};

export type BranchRunRollback = {
  runId: string;
  groupId: string;
  variantId: string;
  fallbackVariantId?: string;
};

export type ClientMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
  fileIds?: string[];
  reasoning?: string;
  sessionTitle?: string;
  rawStream?: string;
  hasStreamUi?: boolean;
  streamUiComplete?: boolean;
  artifactContext?: ArtifactContext;
  snapshot?: RenderSnapshot;
  runtimeErrors?: RenderError[];
  repairOfMessageId?: string;
  repairAttempt?: number;
  branchGroupId?: string;
  branchVariantId?: string;
  branchAnchor?: boolean;
  branchRunRollback?: BranchRunRollback;
  artifactEditBaseRawStream?: string;
  artifactEdits?: ArtifactEdit[];
  activeArtifactEditId?: string;
  generationRunId?: string;
  streamSequence?: number;
  generationOutcome?: "complete" | "error" | "cancelled";
  status?: "streaming" | "complete" | "error";
  error?: string;
};

export type SessionFileKind = "image" | "artifact" | "text";

export type SessionFile = {
  id: string;
  kind: SessionFileKind;
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
  dataUrl?: string;
  text?: string;
  width?: number;
  height?: number;
  summary?: string;
};

export type BugReportImage = {
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

export type BugReportDraft = {
  text: string;
  images: BugReportImage[];
  updatedAt: number;
  screenshotCapturedAt?: number;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  uiComplexity?: number;
  branchSelections?: Record<string, string>;
  messages: ClientMessage[];
  files: SessionFile[];
  bugReportDraft?: BugReportDraft;
};

export type SessionState = {
  sessions: ChatSession[];
  activeSessionId: string;
};

export type NormalizeStoredSessionOptions = {
  rebuildSnapshots?: boolean;
  interruptPendingArtifactEdits?: boolean;
};
