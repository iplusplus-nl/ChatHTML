export type BranchRunRollback = {
  runId: string;
  groupId: string;
  variantId: string;
  fallbackVariantId?: string;
};

export type BranchRunLifecycleMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  branchGroupId?: string;
  branchVariantId?: string;
  branchRunRollback?: BranchRunRollback;
  generationRunId?: string;
  streamSequence?: number;
  generationOutcome?: "complete" | "error" | "cancelled";
  status?: "streaming" | "complete" | "error";
};

export type BranchRunLifecycleSession = {
  branchSelections?: Record<string, string>;
  messages: BranchRunLifecycleMessage[];
};

const BRANCH_ID_MAX_LENGTH = 160;

function normalizedBranchId(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, BRANCH_ID_MAX_LENGTH)
    : "";
}

export function normalizeBranchRunRollback(
  input: unknown
): BranchRunRollback | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const rollback = input as Partial<BranchRunRollback>;
  const runId = normalizedBranchId(rollback.runId);
  const groupId = normalizedBranchId(rollback.groupId);
  const variantId = normalizedBranchId(rollback.variantId);
  const fallbackVariantId = normalizedBranchId(rollback.fallbackVariantId);
  return runId && groupId && variantId
    ? {
        runId,
        groupId,
        variantId,
        fallbackVariantId: fallbackVariantId || undefined
      }
    : undefined;
}

export function getValidBranchRunRollback(
  message: BranchRunLifecycleMessage
): BranchRunRollback | undefined {
  const rollback = message.branchRunRollback;
  return rollback && message.generationRunId === rollback.runId
    ? rollback
    : undefined;
}

export function isCancelledBranchRunTombstone(
  message: BranchRunLifecycleMessage
): boolean {
  return Boolean(
    message.role === "assistant" &&
      message.generationOutcome === "cancelled" &&
      getValidBranchRunRollback(message)
  );
}

function branchKey(groupId: string, variantId: string): string {
  return JSON.stringify([groupId, variantId]);
}

function minimalCancelledBranchRunTombstone<
  Message extends BranchRunLifecycleMessage
>(message: Message, rollback: BranchRunRollback): Message {
  return {
    id: message.id,
    role: "assistant",
    content: "",
    generationRunId: rollback.runId,
    ...(typeof message.streamSequence === "number"
      ? { streamSequence: message.streamSequence }
      : {}),
    generationOutcome: "cancelled",
    status: "complete",
    branchRunRollback: rollback
  } as Message;
}

function liveVariantOrder(
  messages: readonly BranchRunLifecycleMessage[],
  groupId: string
): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (
      message.branchGroupId !== groupId ||
      !message.branchVariantId ||
      seen.has(message.branchVariantId)
    ) {
      continue;
    }
    seen.add(message.branchVariantId);
    variants.push(message.branchVariantId);
  }
  return variants;
}

export function compactCancelledBranchRuns<
  Session extends BranchRunLifecycleSession
>(session: Session): Session {
  const tombstones = session.messages.flatMap((message) => {
    const rollback = isCancelledBranchRunTombstone(message)
      ? getValidBranchRunRollback(message)
      : undefined;
    return rollback ? [{ message, rollback }] : [];
  });
  if (!tombstones.length) {
    return session;
  }

  const tombstoneIds = new Set(tombstones.map(({ message }) => message.id));
  const cancelledVariants = new Set(
    tombstones.map(({ rollback }) =>
      branchKey(rollback.groupId, rollback.variantId)
    )
  );
  const messages = session.messages.flatMap((message) => {
    if (tombstoneIds.has(message.id)) {
      return [
        minimalCancelledBranchRunTombstone(
          message,
          getValidBranchRunRollback(message)!
        )
      ];
    }
    return message.branchGroupId &&
      message.branchVariantId &&
      cancelledVariants.has(
        branchKey(message.branchGroupId, message.branchVariantId)
      )
      ? []
      : [message];
  });

  const branchSelections = { ...(session.branchSelections ?? {}) };
  for (const { rollback } of tombstones) {
    if (branchSelections[rollback.groupId] !== rollback.variantId) {
      continue;
    }
    const variants = liveVariantOrder(messages, rollback.groupId);
    const fallback =
      rollback.fallbackVariantId &&
      variants.includes(rollback.fallbackVariantId)
        ? rollback.fallbackVariantId
        : variants[0];
    if (fallback) {
      branchSelections[rollback.groupId] = fallback;
    } else {
      delete branchSelections[rollback.groupId];
    }
  }

  return {
    ...session,
    branchSelections: Object.keys(branchSelections).length
      ? branchSelections
      : undefined,
    messages
  };
}

export function restoreMissingCancelledBranchTombstones<
  Message extends BranchRunLifecycleMessage
>(current: Message[], merged: Message[]): Message[] {
  const tombstones = current.filter(isCancelledBranchRunTombstone);
  if (!tombstones.length) {
    return merged;
  }

  const result = [...merged];
  const resultIds = new Set(result.map((message) => message.id));
  for (const message of tombstones) {
    if (resultIds.has(message.id)) {
      continue;
    }

    const currentIndex = current.findIndex(
      (candidate) => candidate.id === message.id
    );
    let insertionIndex = -1;
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const previousIndex = result.findIndex(
        (candidate) => candidate.id === current[index].id
      );
      if (previousIndex >= 0) {
        insertionIndex = previousIndex + 1;
        break;
      }
    }
    if (insertionIndex < 0) {
      for (let index = currentIndex + 1; index < current.length; index += 1) {
        const nextIndex = result.findIndex(
          (candidate) => candidate.id === current[index].id
        );
        if (nextIndex >= 0) {
          insertionIndex = nextIndex;
          break;
        }
      }
    }
    result.splice(insertionIndex < 0 ? result.length : insertionIndex, 0, message);
    resultIds.add(message.id);
  }
  return result;
}

function sameRollback(
  left: BranchRunRollback | undefined,
  right: BranchRunRollback
): boolean {
  return (
    left?.runId === right.runId &&
    left.groupId === right.groupId &&
    left.variantId === right.variantId &&
    left.fallbackVariantId === right.fallbackVariantId
  );
}

export function preserveBranchRunLifecycleForClientSave<
  Message extends BranchRunLifecycleMessage
>(
  current: Message | undefined,
  incoming: Message,
  candidate: Message
): Message {
  if (current && isCancelledBranchRunTombstone(current)) {
    return current;
  }

  const currentRollback = current
    ? getValidBranchRunRollback(current)
    : undefined;
  if (
    currentRollback &&
    incoming.generationRunId === currentRollback.runId &&
    !sameRollback(candidate.branchRunRollback, currentRollback)
  ) {
    return { ...candidate, branchRunRollback: currentRollback };
  }
  return candidate;
}

export function mergeBranchSelectionsForClientSave(
  current: BranchRunLifecycleSession,
  incoming: BranchRunLifecycleSession
): Record<string, string> | undefined {
  const selections = { ...(incoming.branchSelections ?? {}) };
  for (const message of current.messages) {
    if (!isCancelledBranchRunTombstone(message)) {
      continue;
    }
    const rollback = getValidBranchRunRollback(message)!;
    const incomingSelection = incoming.branchSelections?.[rollback.groupId];
    if (incomingSelection && incomingSelection !== rollback.variantId) {
      continue;
    }
    selections[rollback.groupId] =
      incomingSelection ??
      current.branchSelections?.[rollback.groupId] ??
      rollback.variantId;
  }
  return Object.keys(selections).length ? selections : undefined;
}
