import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ChatSession,
  ClientMessage
} from "../../domain/chat/sessionModel";
import {
  getAssistantBranchInfo,
  getBranchTurnInsertionIndex,
  getBranchVariantOrder,
  getVisibleSessionMessages,
  isMessageVisibleInSession
} from "./branching";

function message(
  id: string,
  role: ClientMessage["role"],
  branch?: { groupId: string; variantId: string; anchor?: boolean }
): ClientMessage {
  return {
    id,
    role,
    content: id,
    ...(branch
      ? {
          branchGroupId: branch.groupId,
          branchVariantId: branch.variantId,
          branchAnchor: branch.anchor
        }
      : {})
  };
}

function session(
  messages: ClientMessage[],
  branchSelections: Record<string, string> = {}
): ChatSession {
  return {
    id: "session-1",
    title: "Session",
    createdAt: 1,
    updatedAt: 1,
    messages,
    files: [],
    branchSelections
  };
}

describe("chat branching", () => {
  it("shows only the selected branch while keeping unbranched messages", () => {
    const messages = [
      message("before", "user"),
      message("a-user", "user", { groupId: "g1", variantId: "a" }),
      message("a-assistant", "assistant", {
        groupId: "g1",
        variantId: "a",
        anchor: true
      }),
      message("b-user", "user", { groupId: "g1", variantId: "b" }),
      message("b-assistant", "assistant", {
        groupId: "g1",
        variantId: "b",
        anchor: true
      })
    ];
    const activeSession = session(messages, { g1: "b" });

    assert.deepEqual(
      getVisibleSessionMessages(activeSession).map((item) => item.id),
      ["before", "b-user", "b-assistant"]
    );
    assert.equal(isMessageVisibleInSession(activeSession, messages[1]), false);
    assert.equal(isMessageVisibleInSession(activeSession, messages[3]), true);
  });

  it("derives branch navigation from assistant anchors", () => {
    const messages = [
      message("a", "assistant", {
        groupId: "g1",
        variantId: "a",
        anchor: true
      }),
      message("b-user", "user", { groupId: "g1", variantId: "b" }),
      message("b", "assistant", {
        groupId: "g1",
        variantId: "b",
        anchor: true
      }),
      message("b-extra", "assistant", { groupId: "g1", variantId: "b" })
    ];
    const activeSession = session(messages, { g1: "b" });

    assert.deepEqual(getBranchVariantOrder(messages, "g1"), ["a", "b"]);
    assert.deepEqual(
      getAssistantBranchInfo(activeSession, "b"),
      {
        groupId: "g1",
        activeIndex: 1,
        total: 2,
        previousVariantId: "a",
        nextVariantId: undefined
      }
    );
    assert.equal(getAssistantBranchInfo(activeSession, "b-extra"), undefined);
  });

  it("inserts a new branch after the existing contiguous branch group", () => {
    const messages = [
      message("before", "user"),
      message("a", "assistant", { groupId: "g1", variantId: "a" }),
      message("b", "assistant", { groupId: "g1", variantId: "b" }),
      message("after", "user")
    ];

    assert.equal(
      getBranchTurnInsertionIndex(messages, "g1", "before"),
      3
    );
    assert.equal(
      getBranchTurnInsertionIndex(messages, "new-group", "before"),
      1
    );
  });
});
