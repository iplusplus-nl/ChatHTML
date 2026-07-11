import type {
  ChatSession,
  ClientMessage
} from "../../domain/chat/sessionModel";
import {
  getBranchTurnInsertionIndex,
  isMessageVisibleInSession
} from "./branching";
import type { SendStreamUiRequestOptions } from "./chatRunRequest";

export type BranchTurnIdFactory = (
  prefix: "branch" | "variant" | "user"
) => string;

export type BranchTurnPlanInput = {
  session: ChatSession;
  visibleMessages: ClientMessage[];
  userIndex: number;
  activeUser: ClientMessage;
  activeAssistant?: ClientMessage;
  appendUserMessage: boolean;
  userMessagePatch?: Partial<ClientMessage>;
  assistantPatch?: Partial<ClientMessage>;
  preserveFollowingMessages: boolean;
};

export type BranchTurnPlan = {
  appendUserMessage: boolean;
  persistUserMessage?: ClientMessage;
  branchSelection: NonNullable<
    SendStreamUiRequestOptions["branchSelection"]
  >;
  branchRunRollback: NonNullable<
    SendStreamUiRequestOptions["branchRunRollback"]
  >;
  userMessagePatch: Partial<ClientMessage>;
  assistantPatch: Partial<ClientMessage>;
  requestHistory: Exclude<
    NonNullable<SendStreamUiRequestOptions["requestHistory"]>,
    ClientMessage[]
  >;
  insertMessages: NonNullable<
    SendStreamUiRequestOptions["insertMessages"]
  >;
};

/**
 * Builds the deterministic, state-free part of starting a branched chat turn.
 * The caller owns guards and the eventual state write; IDs are injected so the
 * plan can be tested without depending on time or randomness.
 */
export function createBranchTurnPlan(
  {
    session,
    visibleMessages,
    userIndex,
    activeUser,
    activeAssistant,
    appendUserMessage,
    userMessagePatch,
    assistantPatch,
    preserveFollowingMessages
  }: BranchTurnPlanInput,
  createId: BranchTurnIdFactory
): BranchTurnPlan {
  const existingGroupId =
    activeUser.branchGroupId ||
    (activeAssistant?.branchAnchor
      ? activeAssistant.branchGroupId
      : undefined);
  const groupId = existingGroupId || createId("branch");
  const originalVariantId =
    activeUser.branchVariantId ||
    activeAssistant?.branchVariantId ||
    createId("variant");
  const nextVariantId = createId("variant");
  const isNewGroup = !existingGroupId;
  const branchStartId = activeUser.id;
  const branchAnchorId = activeAssistant?.id;
  const historyCutoffIndex = preserveFollowingMessages
    ? getHistoryCutoffIndex(session, activeUser, existingGroupId)
    : -1;
  const historyBeforeUser =
    preserveFollowingMessages && historyCutoffIndex >= 0
      ? session.messages
          .slice(0, historyCutoffIndex)
          .filter((message) => isMessageVisibleInSession(session, message))
      : visibleMessages.slice(0, userIndex);
  const persistUserMessage = appendUserMessage
    ? undefined
    : createPersistedBranchUser(
        activeUser,
        groupId,
        nextVariantId,
        createId("user")
      );

  return {
    appendUserMessage,
    persistUserMessage,
    branchSelection: { groupId, variantId: nextVariantId },
    branchRunRollback: {
      groupId,
      variantId: nextVariantId,
      fallbackVariantId: originalVariantId
    },
    userMessagePatch: {
      ...userMessagePatch,
      fileIds: userMessagePatch?.fileIds ?? activeUser.fileIds,
      branchGroupId: groupId,
      branchVariantId: nextVariantId
    },
    assistantPatch: {
      ...assistantPatch,
      branchGroupId: groupId,
      branchVariantId: nextVariantId,
      branchAnchor: true
    },
    requestHistory: (_previousMessages, userMessage) => [
      ...historyBeforeUser,
      userMessage
    ],
    insertMessages: (messages, userMessage, assistantMessage) => {
      const nextMessages = getNewVariantMessages(
        appendUserMessage,
        persistUserMessage,
        userMessage,
        assistantMessage
      );

      if (preserveFollowingMessages) {
        const sourceMessages = isNewGroup
          ? annotateOriginalTurn(
              messages,
              branchStartId,
              branchAnchorId,
              groupId,
              originalVariantId
            )
          : messages;
        const insertionIndex = getBranchTurnInsertionIndex(
          sourceMessages,
          groupId,
          branchStartId,
          branchAnchorId
        );

        return [
          ...sourceMessages.slice(0, insertionIndex),
          ...nextMessages,
          ...sourceMessages.slice(insertionIndex)
        ];
      }

      if (!isNewGroup) {
        return [...messages, ...nextMessages];
      }

      return [
        ...annotateOriginalTail(
          messages,
          branchStartId,
          branchAnchorId,
          groupId,
          originalVariantId
        ),
        ...nextMessages
      ];
    }
  };
}

function getHistoryCutoffIndex(
  session: ChatSession,
  activeUser: ClientMessage,
  existingGroupId: string | undefined
): number {
  if (existingGroupId) {
    const firstGroupIndex = session.messages.findIndex(
      (message) => message.branchGroupId === existingGroupId
    );
    if (firstGroupIndex >= 0) {
      return firstGroupIndex;
    }
  }

  return session.messages.findIndex((message) => message.id === activeUser.id);
}

function createPersistedBranchUser(
  activeUser: ClientMessage,
  groupId: string,
  variantId: string,
  id: string
): ClientMessage {
  return {
    id,
    role: "user",
    content: activeUser.content,
    fileIds: activeUser.fileIds,
    status: "complete",
    branchGroupId: groupId,
    branchVariantId: variantId
  };
}

function getNewVariantMessages(
  appendUserMessage: boolean,
  persistUserMessage: ClientMessage | undefined,
  userMessage: ClientMessage,
  assistantMessage: ClientMessage
): ClientMessage[] {
  if (appendUserMessage) {
    return [userMessage, assistantMessage];
  }
  return persistUserMessage
    ? [persistUserMessage, assistantMessage]
    : [assistantMessage];
}

function annotateOriginalTurn(
  messages: ClientMessage[],
  branchStartId: string,
  branchAnchorId: string | undefined,
  groupId: string,
  variantId: string
): ClientMessage[] {
  const startIndex = messages.findIndex(
    (message) => message.id === branchStartId
  );
  const branchAnchorIndex = branchAnchorId
    ? messages.findIndex((message) => message.id === branchAnchorId)
    : -1;
  const branchEndIndex =
    branchAnchorIndex >= startIndex ? branchAnchorIndex : startIndex;

  return messages.map((message, index) =>
    startIndex < 0 ||
    index < startIndex ||
    index > branchEndIndex ||
    message.branchGroupId
      ? message
      : annotateOriginalMessage(
          message,
          branchAnchorId,
          groupId,
          variantId
        )
  );
}

function annotateOriginalTail(
  messages: ClientMessage[],
  branchStartId: string,
  branchAnchorId: string | undefined,
  groupId: string,
  variantId: string
): ClientMessage[] {
  const startIndex = messages.findIndex(
    (message) => message.id === branchStartId
  );

  return messages.map((message, index) =>
    startIndex < 0 || index < startIndex || message.branchGroupId
      ? message
      : annotateOriginalMessage(
          message,
          branchAnchorId,
          groupId,
          variantId
        )
  );
}

function annotateOriginalMessage(
  message: ClientMessage,
  branchAnchorId: string | undefined,
  groupId: string,
  variantId: string
): ClientMessage {
  return {
    ...message,
    branchGroupId: groupId,
    branchVariantId: variantId,
    branchAnchor:
      message.id === branchAnchorId ? true : message.branchAnchor
  };
}
