import type {
  BranchRunRollback,
  ChatSession,
  ClientMessage
} from "./sessionTypes";

type BranchRunTarget = {
  runId: string;
  assistantId: string;
};

function branchKey(groupId: string, variantId: string): string {
  return JSON.stringify([groupId, variantId]);
}

export function getValidBranchRunRollback(
  message: ClientMessage
): BranchRunRollback | undefined {
  const rollback = message.branchRunRollback;
  return message.role === "assistant" &&
    rollback &&
    rollback.runId.trim() &&
    rollback.groupId.trim() &&
    rollback.variantId.trim() &&
    message.generationRunId === rollback.runId
    ? rollback
    : undefined;
}

export function isCancelledBranchRunTombstone(
  message: ClientMessage
): boolean {
  return Boolean(
    message.generationOutcome === "cancelled" &&
      getValidBranchRunRollback(message)
  );
}

function minimalCancelledBranchRunTombstone(
  message: ClientMessage,
  rollback: BranchRunRollback
): ClientMessage {
  const minimal: ClientMessage = {
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
  };
  const keys = Object.keys(message) as Array<keyof ClientMessage>;
  const minimalKeys = Object.keys(minimal) as Array<keyof ClientMessage>;
  if (
    keys.length === minimalKeys.length &&
    minimalKeys.every((key) => {
      if (key === "branchRunRollback") {
        return (
          message.branchRunRollback?.runId === rollback.runId &&
          message.branchRunRollback.groupId === rollback.groupId &&
          message.branchRunRollback.variantId === rollback.variantId &&
          message.branchRunRollback.fallbackVariantId ===
            rollback.fallbackVariantId
        );
      }
      return message[key] === minimal[key];
    })
  ) {
    return message;
  }
  return minimal;
}

function liveVariantOrder(messages: ClientMessage[], groupId: string): string[] {
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

function repairBranchSelections(
  session: ChatSession,
  messages: ClientMessage[],
  rollbacks: BranchRunRollback[]
): ChatSession["branchSelections"] {
  const selections = { ...(session.branchSelections ?? {}) };
  let changed = false;
  for (const rollback of rollbacks) {
    if (selections[rollback.groupId] !== rollback.variantId) {
      continue;
    }
    const variants = liveVariantOrder(messages, rollback.groupId);
    const fallback =
      rollback.fallbackVariantId &&
      variants.includes(rollback.fallbackVariantId)
        ? rollback.fallbackVariantId
        : variants[0];
    if (fallback) {
      selections[rollback.groupId] = fallback;
    } else {
      delete selections[rollback.groupId];
    }
    changed = true;
  }
  if (!changed) {
    return session.branchSelections;
  }
  return Object.keys(selections).length ? selections : undefined;
}

export function compactCancelledBranchRuns(
  session: ChatSession
): ChatSession {
  const tombstones = session.messages.flatMap((message) => {
    const rollback = isCancelledBranchRunTombstone(message)
      ? getValidBranchRunRollback(message)
      : undefined;
    return rollback ? [{ message, rollback }] : [];
  });
  if (!tombstones.length) {
    return session;
  }

  const cancelledVariants = new Set(
    tombstones.map(({ rollback }) =>
      branchKey(rollback.groupId, rollback.variantId)
    )
  );
  const tombstoneIds = new Set(
    tombstones.map(({ message }) => message.id)
  );
  let changed = false;
  const messages = session.messages.flatMap((message) => {
    if (tombstoneIds.has(message.id)) {
      const rollback = getValidBranchRunRollback(message)!;
      const minimal = minimalCancelledBranchRunTombstone(message, rollback);
      changed ||= minimal !== message;
      return [minimal];
    }
    if (
      message.branchGroupId &&
      message.branchVariantId &&
      cancelledVariants.has(
        branchKey(message.branchGroupId, message.branchVariantId)
      )
    ) {
      changed = true;
      return [];
    }
    return [message];
  });
  const branchSelections = repairBranchSelections(
    session,
    messages,
    tombstones.map(({ rollback }) => rollback)
  );
  changed ||= branchSelections !== session.branchSelections;
  return changed ? { ...session, messages, branchSelections } : session;
}

export function discardUnacceptedBranchRun(
  session: ChatSession,
  target: BranchRunTarget
): ChatSession {
  const assistant = session.messages.find(
    (message) =>
      message.id === target.assistantId &&
      message.generationRunId === target.runId
  );
  const rollback = assistant
    ? getValidBranchRunRollback(assistant)
    : undefined;
  if (!rollback) {
    return session;
  }
  const messages = session.messages.filter(
    (message) =>
      message.id !== assistant?.id &&
      (message.branchGroupId !== rollback.groupId ||
        message.branchVariantId !== rollback.variantId)
  );
  const branchSelections = repairBranchSelections(session, messages, [rollback]);
  return { ...session, messages, branchSelections };
}
