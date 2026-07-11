import {
  mergeBranchSelectionsForClientSave,
  preserveBranchRunLifecycleForClientSave,
  restoreMissingCancelledBranchTombstones
} from "./sessionBranchRunLifecycle.js";
import { mergeSessionFilesForClientSave } from "./sessionFileUploadSafety.js";
import {
  compactEmptyStoredSessions,
  hasDraftSessionFiles,
  isStoredSessionEmpty,
  mergeDeletedSessionIdLists,
  normalizeStoredSessionState,
  stringValue
} from "./sessionStateModel.js";
import type {
  StoredBugReportDraft,
  StoredMessage,
  StoredSession,
  StoredSessionState
} from "./sessionStateTypes.js";

const STREAM_INTERRUPTED_ERROR =
  "The stream was interrupted before it completed.";

function hasActiveRunMessage(session: StoredSession): boolean {
  return session.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "streaming" &&
      Boolean(message.generationRunId)
  );
}

function shouldPreserveCurrentRunMessage(
  current: StoredMessage | undefined,
  incoming: StoredMessage
): boolean {
  if (!current || current.role !== "assistant" || !current.generationRunId) {
    return false;
  }
  if (current.generationRunId !== incoming.generationRunId) {
    return current.status === "streaming";
  }

  const currentSequence = current.streamSequence ?? -1;
  const incomingSequence = incoming.streamSequence ?? -1;
  if (
    current.generationOutcome &&
    current.generationOutcome !== incoming.generationOutcome
  ) {
    return true;
  }
  const incomingInterrupted =
    incoming.status === "error" && incoming.error === STREAM_INTERRUPTED_ERROR;

  if (currentSequence > incomingSequence) {
    return true;
  }

  if (current.status === "complete" && incoming.status !== "complete") {
    return true;
  }

  if (
    current.status === "streaming" &&
    incomingInterrupted &&
    currentSequence > incomingSequence
  ) {
    return true;
  }

  return false;
}

function artifactEditObjects(
  message: StoredMessage | undefined
): Record<string, unknown>[] {
  return (message?.artifactEdits ?? []).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function artifactEditId(edit: Record<string, unknown>): string {
  return stringValue(edit.id).trim();
}

function artifactEditVariants(
  edit: Record<string, unknown> | undefined
): Record<string, unknown>[] {
  return (Array.isArray(edit?.variants) ? edit.variants : []).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function hasCompletedArtifactEditVariant(
  edit: Record<string, unknown> | undefined
): boolean {
  return artifactEditVariants(edit).some(
    (variant) =>
      variant.status === "complete" &&
      typeof variant.rawStream === "string" &&
      Boolean(variant.rawStream.trim())
  );
}

function hasArtifactEditState(message: StoredMessage | undefined): boolean {
  return Boolean(
    message?.artifactEditBaseRawStream ||
      message?.activeArtifactEditId ||
      artifactEditObjects(message).length
  );
}

function shouldPreserveCurrentArtifactEditMessage(
  current: StoredMessage | undefined,
  incoming: StoredMessage
): boolean {
  if (!current || !hasArtifactEditState(current)) {
    return false;
  }

  if (!hasArtifactEditState(incoming)) {
    return true;
  }

  const currentEdits = artifactEditObjects(current);
  const incomingEdits = artifactEditObjects(incoming);
  const incomingById = new Map(
    incomingEdits.map((edit) => [artifactEditId(edit), edit])
  );

  if (currentEdits.length > incomingEdits.length) {
    return true;
  }

  for (const edit of currentEdits) {
    const id = artifactEditId(edit);
    const incomingEdit = incomingById.get(id);
    if (!id || !incomingEdit) {
      return true;
    }

    if (
      hasCompletedArtifactEditVariant(edit) &&
      !hasCompletedArtifactEditVariant(incomingEdit)
    ) {
      return true;
    }
  }

  const currentActiveId = stringValue(current.activeArtifactEditId).trim();
  const incomingActiveId = stringValue(incoming.activeArtifactEditId).trim();
  if (currentActiveId && currentActiveId !== incomingActiveId) {
    return true;
  }

  return false;
}

function mergeMessagesForClientSave(
  current: StoredMessage[],
  incoming: StoredMessage[],
  options: { preserveStaleArtifactEdits?: boolean } = {}
): StoredMessage[] {
  const currentById = new Map(current.map((message) => [message.id, message]));
  const incomingIds = new Set(incoming.map((message) => message.id));
  const missingActiveRun = current.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "streaming" &&
      Boolean(message.generationRunId) &&
      !incomingIds.has(message.id)
  );

  if (missingActiveRun) {
    return current;
  }

  const merged = incoming.map((message) => {
    const currentMessage = currentById.get(message.id);
    let candidate: StoredMessage;
    if (
      options.preserveStaleArtifactEdits &&
      shouldPreserveCurrentArtifactEditMessage(currentMessage, message)
    ) {
      candidate = currentMessage ?? message;
    } else {
      candidate = shouldPreserveCurrentRunMessage(currentMessage, message)
        ? currentMessage ?? message
        : message;
    }

    return preserveBranchRunLifecycleForClientSave(
      currentMessage,
      message,
      candidate
    );
  });
  return restoreMissingCancelledBranchTombstones(current, merged);
}

function mergeBugReportDraftForClientSave(
  current: StoredBugReportDraft | undefined,
  incoming: StoredBugReportDraft | undefined,
  incomingIsOlder: boolean
): StoredBugReportDraft | undefined {
  if (
    incomingIsOlder &&
    current &&
    (!incoming || current.updatedAt > incoming.updatedAt)
  ) {
    return current;
  }

  return incoming;
}

export function mergeClientSaveState(
  current: StoredSessionState,
  incoming: StoredSessionState,
  deletedSessionIds = new Set<string>()
): StoredSessionState {
  const mergedDeletedSessionIds = mergeDeletedSessionIdLists(
    current.deletedSessionIds,
    incoming.deletedSessionIds,
    Array.from(deletedSessionIds)
  );
  const tombstones = new Set(mergedDeletedSessionIds);
  const currentSessions = current.sessions.filter(
    (session) => !tombstones.has(session.id)
  );
  const compactedIncoming = compactEmptyStoredSessions(
    incoming.sessions.filter((session) => !tombstones.has(session.id)),
    incoming.activeSessionId
  );
  const incomingSessions = compactedIncoming.sessions.filter(
    (session) => !tombstones.has(session.id)
  );
  const currentById = new Map(
    currentSessions.map((session) => [session.id, session])
  );
  const incomingIds = new Set(incomingSessions.map((session) => session.id));
  const sessions = incomingSessions.map((session) => {
    const currentSession = currentById.get(session.id);
    if (!currentSession) {
      return session;
    }
    const hasActiveRun = hasActiveRunMessage(currentSession);
    const incomingIsOlder = session.updatedAt <= currentSession.updatedAt;

    return {
      ...session,
      branchSelections: mergeBranchSelectionsForClientSave(
        currentSession,
        session
      ),
      updatedAt: hasActiveRun
        ? Math.max(session.updatedAt, currentSession.updatedAt)
        : session.updatedAt,
      messages: mergeMessagesForClientSave(currentSession.messages, session.messages, {
        preserveStaleArtifactEdits: incomingIsOlder
      }),
      files: mergeSessionFilesForClientSave(
        currentSession.files,
        session.files,
        hasActiveRun
      ),
      bugReportDraft: mergeBugReportDraftForClientSave(
        currentSession.bugReportDraft,
        session.bugReportDraft,
        incomingIsOlder
      )
    };
  });

  for (const session of currentSessions) {
    if (
      !incomingIds.has(session.id) &&
      (!isStoredSessionEmpty(session) || hasDraftSessionFiles(session))
    ) {
      sessions.push(session);
    }
  }

  const activeSessionId = sessions.some(
    (session) => session.id === compactedIncoming.activeSessionId
  )
    ? compactedIncoming.activeSessionId
    : sessions[0]?.id ?? compactedIncoming.activeSessionId;

  return normalizeStoredSessionState({
    sessions,
    activeSessionId,
    deletedSessionIds: mergedDeletedSessionIds,
    clientSaveRevisions: current.clientSaveRevisions
  });
}
