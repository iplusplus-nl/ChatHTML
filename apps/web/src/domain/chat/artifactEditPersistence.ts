import { sortSessions } from "./sessionLifecycle";
import type {
  ArtifactEdit,
  ArtifactEditReference,
  ArtifactEditRollback,
  ArtifactEditVariant,
  ClientMessage,
  SessionState
} from "./sessionTypes";

const LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR =
  "The local edit was interrupted.";
const LOCAL_ARTIFACT_EDIT_INTERRUPTION_GRACE_MS = 15 * 60 * 1000;

export const STALE_ARTIFACT_EDIT_SWEEP_INTERVAL_MS = 30 * 1000;

function normalizeBoundedString(
  input: unknown,
  maxLength: number
): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const value = input.trim().slice(0, maxLength);
  return value || undefined;
}

function normalizeArtifactEditReference(
  input: unknown
): ArtifactEditReference | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const reference = input as Partial<ArtifactEditReference>;
  const kind =
    reference.kind === "element" || reference.kind === "text"
      ? reference.kind
      : null;
  const key = normalizeBoundedString(reference.key, 240);
  const selector = normalizeBoundedString(reference.selector, 500);
  if (!kind || !key || !selector) {
    return null;
  }

  return {
    kind,
    key,
    selector,
    label: normalizeBoundedString(reference.label, 160) ?? "Reference",
    preview: normalizeBoundedString(reference.preview, 500) ?? "",
    tagName: normalizeBoundedString(reference.tagName, 80),
    text: normalizeBoundedString(reference.text, 2_000),
    html: normalizeBoundedString(reference.html, 8_000)
  };
}

function normalizeArtifactEditReferences(
  input: unknown
): ArtifactEditReference[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const references: ArtifactEditReference[] = [];
  for (const item of input) {
    const reference = normalizeArtifactEditReference(item);
    if (!reference || seen.has(reference.key)) {
      continue;
    }
    seen.add(reference.key);
    references.push(reference);
    if (references.length >= 8) {
      break;
    }
  }

  return references;
}

function normalizeArtifactEditVariant(
  input: unknown,
  now = Date.now(),
  interruptPending = false
): ArtifactEditVariant | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const variant = input as Partial<ArtifactEditVariant>;
  const id = normalizeBoundedString(variant.id, 160);
  if (!id) {
    return null;
  }
  const createdAt =
    typeof variant.createdAt === "number" && Number.isFinite(variant.createdAt)
      ? variant.createdAt
      : now;
  const error = normalizeBoundedString(variant.error, 800);
  const rawStatus =
    variant.status === "pending" ||
    variant.status === "complete" ||
    variant.status === "error"
      ? variant.status
      : "complete";
  const isRecentInterruptedError =
    rawStatus === "error" &&
    error === LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR &&
    now - createdAt < LOCAL_ARTIFACT_EDIT_INTERRUPTION_GRACE_MS;
  const status = isRecentInterruptedError ? "pending" : rawStatus;
  const shouldInterrupt =
    interruptPending &&
    status === "pending" &&
    now - createdAt >= LOCAL_ARTIFACT_EDIT_INTERRUPTION_GRACE_MS;
  const restoredStatus = shouldInterrupt ? "error" : status;
  const normalizedError =
    error === LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR &&
    (isRecentInterruptedError || restoredStatus !== "error")
      ? undefined
      : error;

  return {
    id,
    operationId: normalizeBoundedString(variant.operationId, 160),
    createdAt,
    status: restoredStatus,
    rawStream:
      typeof variant.rawStream === "string" ? variant.rawStream : undefined,
    summary: normalizeBoundedString(variant.summary, 500),
    error:
      normalizedError ??
      (shouldInterrupt ? LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR : undefined),
    editCount:
      typeof variant.editCount === "number" && Number.isFinite(variant.editCount)
        ? Math.max(0, Math.round(variant.editCount))
        : undefined
  };
}

function normalizeArtifactEditRollback(
  input: unknown
): ArtifactEditRollback | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const rollback = input as Partial<ArtifactEditRollback>;
  return {
    reasoning:
      typeof rollback.reasoning === "string" ? rollback.reasoning : undefined,
    sessionTitle: normalizeBoundedString(rollback.sessionTitle, 500),
    repairOfMessageId: normalizeBoundedString(
      rollback.repairOfMessageId,
      160
    ),
    repairAttempt:
      typeof rollback.repairAttempt === "number" &&
      Number.isFinite(rollback.repairAttempt)
        ? Math.max(1, Math.round(rollback.repairAttempt))
        : undefined
  };
}

function normalizeArtifactEdit(
  input: unknown,
  now = Date.now(),
  interruptPending = false
): ArtifactEdit | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const edit = input as Partial<ArtifactEdit>;
  const id = normalizeBoundedString(edit.id, 160);
  const prompt = normalizeBoundedString(edit.prompt, 8_000);
  if (!id || !prompt) {
    return null;
  }
  const createdAt =
    typeof edit.createdAt === "number" && Number.isFinite(edit.createdAt)
      ? edit.createdAt
      : now;
  const error = normalizeBoundedString(edit.error, 800);
  const inputVariants = Array.isArray(edit.variants) ? edit.variants : [];
  const variants = inputVariants.length
    ? inputVariants
        .map((variant) =>
          normalizeArtifactEditVariant(
            variant,
            now,
            interruptPending && edit.origin !== "chat-run"
          )
        )
        .filter((variant): variant is ArtifactEditVariant => variant !== null)
    : [];
  const rawStatus =
    edit.status === "pending" || edit.status === "complete" || edit.status === "error"
      ? edit.status
      : variants.some((variant) => variant.status === "pending")
          ? "pending"
          : variants.some((variant) => variant.status === "error")
            ? "error"
            : "complete";
  const hasPendingVariant = variants.some((variant) => variant.status === "pending");
  const pendingActivityAt = Math.max(
    rawStatus === "pending" ? createdAt : Number.NEGATIVE_INFINITY,
    ...variants
      .filter((variant) => variant.status === "pending")
      .map((variant) => variant.createdAt)
  );
  const latestPendingActivityAt = Number.isFinite(pendingActivityAt)
    ? pendingActivityAt
    : createdAt;
  const isRecentInterruptedError =
    rawStatus === "error" &&
    ((error === LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR &&
      now - latestPendingActivityAt < LOCAL_ARTIFACT_EDIT_INTERRUPTION_GRACE_MS) ||
      ((!error || error === LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR) &&
        hasPendingVariant));
  const status = isRecentInterruptedError ? "pending" : rawStatus;
  const shouldInterrupt =
    interruptPending &&
    edit.origin !== "chat-run" &&
    status === "pending" &&
    now - latestPendingActivityAt >= LOCAL_ARTIFACT_EDIT_INTERRUPTION_GRACE_MS;
  const restoredStatus = shouldInterrupt ? "error" : status;
  const activeVariantId = normalizeBoundedString(edit.activeVariantId, 160);
  const normalizedError =
    error === LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR &&
    (isRecentInterruptedError || restoredStatus !== "error")
      ? undefined
      : error;

  return {
    id,
    origin: edit.origin === "chat-run" ? "chat-run" : undefined,
    parentId: normalizeBoundedString(edit.parentId, 160),
    createdAt,
    prompt,
    references: normalizeArtifactEditReferences(edit.references),
    promptBubble: edit.promptBubble === false ? false : undefined,
    activeVariantId:
      activeVariantId && variants.some((variant) => variant.id === activeVariantId)
        ? activeVariantId
        : variants[0]?.id,
    variants,
    status: restoredStatus,
    error:
      normalizedError ??
      (shouldInterrupt ? LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR : undefined),
    rollback: normalizeArtifactEditRollback(edit.rollback)
  };
}

export function normalizeArtifactEdits(
  input: unknown,
  interruptPending = false
): ArtifactEdit[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const now = Date.now();
  const seen = new Set<string>();
  const edits: ArtifactEdit[] = [];
  for (const item of input) {
    const edit = normalizeArtifactEdit(item, now, interruptPending);
    if (!edit || seen.has(edit.id)) {
      continue;
    }
    seen.add(edit.id);
    edits.push(edit);
  }

  return edits.length ? edits : undefined;
}

function interruptStaleArtifactEditVariant(
  variant: ArtifactEditVariant,
  now = Date.now()
): ArtifactEditVariant {
  if (
    variant.status !== "pending" ||
    now - variant.createdAt < LOCAL_ARTIFACT_EDIT_INTERRUPTION_GRACE_MS
  ) {
    return variant;
  }

  return {
    ...variant,
    status: "error",
    error: variant.error ?? LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR
  };
}

function latestPendingArtifactEditActivityAt(
  edit: ArtifactEdit
): number | undefined {
  const pendingTimes = edit.variants
    .filter((variant) => variant.status === "pending")
    .map((variant) => variant.createdAt);
  if (edit.status === "pending") {
    pendingTimes.push(edit.createdAt);
  }
  return pendingTimes.length ? Math.max(...pendingTimes) : undefined;
}

function interruptStaleArtifactEdit(
  edit: ArtifactEdit,
  now = Date.now()
): ArtifactEdit {
  const variants = edit.variants.map((variant) =>
    interruptStaleArtifactEditVariant(variant, now)
  );
  const didVariantChange = variants.some(
    (variant, index) => variant !== edit.variants[index]
  );
  const latestPendingAt = latestPendingArtifactEditActivityAt({
    ...edit,
    variants
  });
  const shouldInterruptEdit =
    edit.status === "pending" &&
    latestPendingAt !== undefined &&
    now - latestPendingAt >= LOCAL_ARTIFACT_EDIT_INTERRUPTION_GRACE_MS;

  if (!didVariantChange && !shouldInterruptEdit) {
    return edit;
  }

  return {
    ...edit,
    variants,
    status: shouldInterruptEdit ? "error" : edit.status,
    error: shouldInterruptEdit
      ? edit.error ?? LOCAL_ARTIFACT_EDIT_INTERRUPTED_ERROR
      : edit.error
  };
}

export function interruptStaleArtifactEditsInMessage(
  message: ClientMessage,
  now = Date.now()
): ClientMessage {
  if (message.role !== "assistant" || !message.artifactEdits?.length) {
    return message;
  }

  const artifactEdits = message.artifactEdits.map((edit) =>
    edit.origin === "chat-run" ? edit : interruptStaleArtifactEdit(edit, now)
  );
  const didChange = artifactEdits.some(
    (edit, index) => edit !== message.artifactEdits?.[index]
  );

  return didChange
    ? {
        ...message,
        artifactEdits
      }
    : message;
}

export function interruptStaleArtifactEditsInSessionState(
  state: SessionState,
  now = Date.now()
): SessionState {
  let didChange = false;
  const sessions = state.sessions.map((session) => {
    let didChangeSession = false;
    const messages = session.messages.map((message) => {
      const nextMessage = interruptStaleArtifactEditsInMessage(message, now);
      if (nextMessage !== message) {
        didChangeSession = true;
      }
      return nextMessage;
    });

    if (!didChangeSession) {
      return session;
    }

    didChange = true;
    return {
      ...session,
      updatedAt: Math.max(session.updatedAt, now),
      messages
    };
  });

  return didChange
    ? {
        ...state,
        sessions: sortSessions(sessions)
      }
    : state;
}
