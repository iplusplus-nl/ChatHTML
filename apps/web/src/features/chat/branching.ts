import {
  initialMessages,
  type ChatSession,
  type ClientMessage
} from "../../domain/chat/sessionModel";

export type MessageBranchInfo = {
  groupId: string;
  activeIndex: number;
  total: number;
  previousVariantId?: string;
  nextVariantId?: string;
};

function getCancelledBranchRunRollbacks(
  messages: ClientMessage[],
  groupId: string
) {
  const rollbacks = new Map<
    string,
    NonNullable<ClientMessage["branchRunRollback"]>
  >();
  for (const message of messages) {
    const rollback = message.branchRunRollback;
    if (
      !rollback ||
      message.role !== "assistant" ||
      message.generationOutcome !== "cancelled" ||
      message.generationRunId !== rollback.runId ||
      rollback.groupId !== groupId
    ) {
      continue;
    }
    rollbacks.set(rollback.variantId, rollback);
  }
  return rollbacks;
}

export function getMessageBranchGroup(
  message: ClientMessage
): string | undefined {
  return message.branchGroupId && message.branchVariantId
    ? message.branchGroupId
    : undefined;
}

export function getBranchVariantOrder(
  messages: ClientMessage[],
  groupId: string,
  options: { anchorsOnly?: boolean } = {}
): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  const cancelledVariants = getCancelledBranchRunRollbacks(messages, groupId);

  for (const message of messages) {
    if (
      message.branchGroupId !== groupId ||
      !message.branchVariantId ||
      cancelledVariants.has(message.branchVariantId) ||
      (options.anchorsOnly && !(message.role === "assistant" && message.branchAnchor))
    ) {
      continue;
    }

    if (!seen.has(message.branchVariantId)) {
      seen.add(message.branchVariantId);
      variants.push(message.branchVariantId);
    }
  }

  return variants;
}

export function getBranchTurnInsertionIndex(
  messages: ClientMessage[],
  groupId: string,
  branchStartId: string,
  branchAnchorId?: string
): number {
  const firstBranchIndex = messages.findIndex(
    (message) => message.branchGroupId === groupId
  );
  if (firstBranchIndex >= 0) {
    let index = firstBranchIndex;
    while (index < messages.length && messages[index].branchGroupId === groupId) {
      index += 1;
    }
    return index;
  }

  const anchorIndex = branchAnchorId
    ? messages.findIndex((message) => message.id === branchAnchorId)
    : -1;
  if (anchorIndex >= 0) {
    return anchorIndex + 1;
  }

  const startIndex = messages.findIndex((message) => message.id === branchStartId);
  return startIndex >= 0 ? startIndex + 1 : messages.length;
}

export function getSelectedBranchVariant(
  session: ChatSession,
  groupId: string
): string | undefined {
  const variants = getBranchVariantOrder(session.messages, groupId);
  if (!variants.length) {
    return undefined;
  }

  const selected = session.branchSelections?.[groupId];
  if (selected && variants.includes(selected)) {
    return selected;
  }

  const fallback = selected
    ? getCancelledBranchRunRollbacks(session.messages, groupId).get(selected)
        ?.fallbackVariantId
    : undefined;
  return fallback && variants.includes(fallback) ? fallback : variants[0];
}

export function isMessageVisibleInSession(
  session: ChatSession,
  message: ClientMessage
): boolean {
  if (
    message.role === "assistant" &&
    message.generationOutcome === "cancelled" &&
    message.generationRunId === message.branchRunRollback?.runId
  ) {
    return false;
  }
  const groupId = getMessageBranchGroup(message);
  if (!groupId || !message.branchVariantId) {
    return true;
  }

  return getSelectedBranchVariant(session, groupId) === message.branchVariantId;
}

export function getVisibleSessionMessages(
  session: ChatSession | undefined
): ClientMessage[] {
  if (!session) {
    return initialMessages;
  }

  return session.messages.filter((message) =>
    isMessageVisibleInSession(session, message)
  );
}

export function getAssistantForUserTurn(
  messages: ClientMessage[],
  userIndex: number
): ClientMessage | undefined {
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "user") {
      return undefined;
    }
    if (message.role === "assistant") {
      return message;
    }
  }

  return undefined;
}

export function getAssistantBranchInfo(
  session: ChatSession | undefined,
  messageId: string
): MessageBranchInfo | undefined {
  if (!session) {
    return undefined;
  }

  const message = session.messages.find((candidate) => candidate.id === messageId);
  if (
    !message ||
    message.role !== "assistant" ||
    !message.branchAnchor ||
    !message.branchGroupId ||
    !message.branchVariantId ||
    !isMessageVisibleInSession(session, message)
  ) {
    return undefined;
  }

  const variants = getBranchVariantOrder(session.messages, message.branchGroupId, {
    anchorsOnly: true
  });
  if (variants.length <= 1) {
    return undefined;
  }

  const activeIndex = variants.indexOf(message.branchVariantId);
  if (activeIndex < 0) {
    return undefined;
  }

  return {
    groupId: message.branchGroupId,
    activeIndex,
    total: variants.length,
    previousVariantId: variants[activeIndex - 1],
    nextVariantId: variants[activeIndex + 1]
  };
}
