import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ChatSession,
  ClientMessage
} from "../../domain/chat/sessionModel";
import {
  createBranchTurnPlan,
  type BranchTurnIdFactory
} from "./branchTurnPlanner";

function message(
  id: string,
  role: ClientMessage["role"],
  overrides: Partial<ClientMessage> = {}
): ClientMessage {
  return {
    id,
    role,
    content: `${id} content`,
    ...overrides
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

function queuedIds(...ids: string[]): {
  createId: BranchTurnIdFactory;
  prefixes: string[];
} {
  const prefixes: string[] = [];
  return {
    prefixes,
    createId: (prefix) => {
      prefixes.push(prefix);
      const id = ids.shift();
      assert.ok(id, `Missing test ID for ${prefix}`);
      return id;
    }
  };
}

function requestMessage(
  id: string,
  role: ClientMessage["role"]
): ClientMessage {
  return message(id, role, { status: role === "user" ? "complete" : "streaming" });
}

describe("branch turn planner", () => {
  it("plans a new branch, annotates the original tail, and carries rollback metadata", () => {
    const messages = [
      message("before", "assistant"),
      message("original-user", "user", { fileIds: ["file-1"] }),
      message("original-assistant", "assistant"),
      message("following-user", "user"),
      message("following-assistant", "assistant")
    ];
    const activeSession = session(messages);
    const ids = queuedIds("group-new", "variant-original", "variant-next");
    const plan = createBranchTurnPlan(
      {
        session: activeSession,
        visibleMessages: messages,
        userIndex: 1,
        activeUser: messages[1] as ClientMessage & { role: "user" },
        activeAssistant: messages[2],
        appendUserMessage: true,
        preserveFollowingMessages: false
      },
      ids.createId
    );

    assert.deepEqual(ids.prefixes, ["branch", "variant", "variant"]);
    assert.deepEqual(plan.branchSelection, {
      groupId: "group-new",
      variantId: "variant-next"
    });
    assert.deepEqual(plan.branchRunRollback, {
      groupId: "group-new",
      variantId: "variant-next",
      fallbackVariantId: "variant-original"
    });
    assert.deepEqual(plan.userMessagePatch, {
      fileIds: ["file-1"],
      branchGroupId: "group-new",
      branchVariantId: "variant-next"
    });
    assert.deepEqual(plan.assistantPatch, {
      branchGroupId: "group-new",
      branchVariantId: "variant-next",
      branchAnchor: true
    });

    const nextUser = requestMessage("next-user", "user");
    const nextAssistant = requestMessage("next-assistant", "assistant");
    assert.deepEqual(
      plan.requestHistory([], nextUser, nextAssistant).map((item) => item.id),
      ["before", "next-user"]
    );
    const inserted = plan.insertMessages(messages, nextUser, nextAssistant);
    assert.deepEqual(
      inserted.map((item) => item.id),
      [
        "before",
        "original-user",
        "original-assistant",
        "following-user",
        "following-assistant",
        "next-user",
        "next-assistant"
      ]
    );
    assert.deepEqual(
      inserted.slice(1, 5).map((item) => ({
        groupId: item.branchGroupId,
        variantId: item.branchVariantId,
        anchor: item.branchAnchor
      })),
      [
        {
          groupId: "group-new",
          variantId: "variant-original",
          anchor: undefined
        },
        {
          groupId: "group-new",
          variantId: "variant-original",
          anchor: true
        },
        {
          groupId: "group-new",
          variantId: "variant-original",
          anchor: undefined
        },
        {
          groupId: "group-new",
          variantId: "variant-original",
          anchor: undefined
        }
      ]
    );
    assert.equal(messages[1].branchGroupId, undefined);
    assert.equal(messages[2].branchAnchor, undefined);
  });

  it("reuses an existing group and appends the new variant without rewriting it", () => {
    const messages = [
      message("before", "assistant"),
      message("a-user", "user", {
        branchGroupId: "group-1",
        branchVariantId: "variant-a"
      }),
      message("a-assistant", "assistant", {
        branchGroupId: "group-1",
        branchVariantId: "variant-a",
        branchAnchor: true
      })
    ];
    const ids = queuedIds("variant-b");
    const plan = createBranchTurnPlan(
      {
        session: session(messages, { "group-1": "variant-a" }),
        visibleMessages: messages,
        userIndex: 1,
        activeUser: messages[1] as ClientMessage & { role: "user" },
        activeAssistant: messages[2],
        appendUserMessage: true,
        preserveFollowingMessages: false
      },
      ids.createId
    );

    assert.deepEqual(ids.prefixes, ["variant"]);
    assert.deepEqual(plan.branchRunRollback, {
      groupId: "group-1",
      variantId: "variant-b",
      fallbackVariantId: "variant-a"
    });
    const inserted = plan.insertMessages(
      messages,
      requestMessage("b-user", "user"),
      requestMessage("b-assistant", "assistant")
    );
    assert.deepEqual(inserted.slice(0, messages.length), messages);
    assert.deepEqual(inserted.map((item) => item.id), [
      "before",
      "a-user",
      "a-assistant",
      "b-user",
      "b-assistant"
    ]);
  });

  it("recognizes an existing group carried by an assistant branch anchor", () => {
    const activeUser = message("a-user", "user");
    const activeAssistant = message("a-assistant", "assistant", {
      branchGroupId: "group-1",
      branchVariantId: "variant-a",
      branchAnchor: true
    });
    const ids = queuedIds("variant-b");
    const plan = createBranchTurnPlan(
      {
        session: session([activeUser, activeAssistant], {
          "group-1": "variant-a"
        }),
        visibleMessages: [activeUser, activeAssistant],
        userIndex: 0,
        activeUser,
        activeAssistant,
        appendUserMessage: true,
        preserveFollowingMessages: false
      },
      ids.createId
    );

    assert.deepEqual(ids.prefixes, ["variant"]);
    assert.deepEqual(plan.branchRunRollback, {
      groupId: "group-1",
      variantId: "variant-b",
      fallbackVariantId: "variant-a"
    });
  });

  it("persists a synthetic branch user when the request must not append its user", () => {
    const activeUser = message("original-user", "user", {
      content: "Original prompt",
      fileIds: ["source-file"]
    });
    const activeAssistant = message("original-assistant", "assistant");
    const messages = [activeUser, activeAssistant];
    const ids = queuedIds(
      "group-new",
      "variant-original",
      "variant-next",
      "persisted-user"
    );
    const plan = createBranchTurnPlan(
      {
        session: session(messages),
        visibleMessages: messages,
        userIndex: 0,
        activeUser: activeUser as ClientMessage & { role: "user" },
        activeAssistant,
        appendUserMessage: false,
        preserveFollowingMessages: false
      },
      ids.createId
    );

    assert.deepEqual(ids.prefixes, ["branch", "variant", "variant", "user"]);
    assert.deepEqual(plan.persistUserMessage, {
      id: "persisted-user",
      role: "user",
      content: "Original prompt",
      fileIds: ["source-file"],
      status: "complete",
      branchGroupId: "group-new",
      branchVariantId: "variant-next"
    });
    const requestUser = requestMessage("request-only-user", "user");
    const inserted = plan.insertMessages(
      messages,
      requestUser,
      requestMessage("next-assistant", "assistant")
    );
    assert.equal(inserted.some((item) => item.id === requestUser.id), false);
    assert.deepEqual(inserted.slice(-2).map((item) => item.id), [
      "persisted-user",
      "next-assistant"
    ]);
  });

  it("merges caller patches while keeping branch identity authoritative", () => {
    const activeUser = message("original-user", "user", {
      fileIds: ["source-file"]
    });
    const activeAssistant = message("original-assistant", "assistant");
    const ids = queuedIds("group-new", "variant-original", "variant-next");
    const plan = createBranchTurnPlan(
      {
        session: session([activeUser, activeAssistant]),
        visibleMessages: [activeUser, activeAssistant],
        userIndex: 0,
        activeUser: activeUser as ClientMessage & { role: "user" },
        activeAssistant,
        appendUserMessage: true,
        preserveFollowingMessages: false,
        userMessagePatch: {
          reasoning: "user metadata",
          fileIds: [],
          branchGroupId: "wrong-group",
          branchVariantId: "wrong-variant"
        },
        assistantPatch: {
          reasoning: "assistant metadata",
          branchGroupId: "wrong-group",
          branchVariantId: "wrong-variant",
          branchAnchor: false
        }
      },
      ids.createId
    );

    assert.deepEqual(plan.userMessagePatch, {
      reasoning: "user metadata",
      fileIds: [],
      branchGroupId: "group-new",
      branchVariantId: "variant-next"
    });
    assert.deepEqual(plan.assistantPatch, {
      reasoning: "assistant metadata",
      branchGroupId: "group-new",
      branchVariantId: "variant-next",
      branchAnchor: true
    });
  });

  it("preserves following messages by inserting after only the original turn", () => {
    const messages = [
      message("before", "assistant"),
      message("edited-user", "user"),
      message("edited-assistant", "assistant"),
      message("following-user", "user"),
      message("following-assistant", "assistant")
    ];
    const original = structuredClone(messages);
    const ids = queuedIds("group-new", "variant-original", "variant-next");
    const plan = createBranchTurnPlan(
      {
        session: session(messages),
        visibleMessages: messages,
        userIndex: 1,
        activeUser: messages[1] as ClientMessage & { role: "user" },
        activeAssistant: messages[2],
        appendUserMessage: true,
        preserveFollowingMessages: true
      },
      ids.createId
    );
    const nextUser = requestMessage("next-user", "user");
    const nextAssistant = requestMessage("next-assistant", "assistant");

    assert.deepEqual(
      plan.requestHistory([], nextUser, nextAssistant).map((item) => item.id),
      ["before", "next-user"]
    );
    const inserted = plan.insertMessages(messages, nextUser, nextAssistant);
    assert.deepEqual(inserted.map((item) => item.id), [
      "before",
      "edited-user",
      "edited-assistant",
      "next-user",
      "next-assistant",
      "following-user",
      "following-assistant"
    ]);
    assert.equal(inserted[1].branchGroupId, "group-new");
    assert.equal(inserted[2].branchAnchor, true);
    assert.equal(inserted[5].branchGroupId, undefined);
    assert.equal(inserted[6].branchGroupId, undefined);
    assert.deepEqual(messages, original);
  });

  it("inserts after every existing variant but before preserved following messages", () => {
    const messages = [
      message("before", "assistant"),
      message("a-user", "user", {
        branchGroupId: "group-1",
        branchVariantId: "variant-a"
      }),
      message("a-assistant", "assistant", {
        branchGroupId: "group-1",
        branchVariantId: "variant-a",
        branchAnchor: true
      }),
      message("b-user", "user", {
        branchGroupId: "group-1",
        branchVariantId: "variant-b"
      }),
      message("b-assistant", "assistant", {
        branchGroupId: "group-1",
        branchVariantId: "variant-b",
        branchAnchor: true
      }),
      message("following-user", "user")
    ];
    const activeSession = session(messages, { "group-1": "variant-b" });
    const visibleMessages = [messages[0], messages[3], messages[4], messages[5]];
    const ids = queuedIds("variant-c");
    const plan = createBranchTurnPlan(
      {
        session: activeSession,
        visibleMessages,
        userIndex: 1,
        activeUser: messages[3] as ClientMessage & { role: "user" },
        activeAssistant: messages[4],
        appendUserMessage: true,
        preserveFollowingMessages: true
      },
      ids.createId
    );
    const nextUser = requestMessage("c-user", "user");
    const nextAssistant = requestMessage("c-assistant", "assistant");

    assert.deepEqual(
      plan.requestHistory([], nextUser, nextAssistant).map((item) => item.id),
      ["before", "c-user"]
    );
    assert.deepEqual(
      plan
        .insertMessages(messages, nextUser, nextAssistant)
        .map((item) => item.id),
      [
        "before",
        "a-user",
        "a-assistant",
        "b-user",
        "b-assistant",
        "c-user",
        "c-assistant",
        "following-user"
      ]
    );
  });

  it("filters hidden variants from preserved request history", () => {
    const messages = [
      message("hidden", "assistant", {
        branchGroupId: "earlier-group",
        branchVariantId: "hidden-variant",
        branchAnchor: true
      }),
      message("visible", "assistant", {
        branchGroupId: "earlier-group",
        branchVariantId: "visible-variant",
        branchAnchor: true
      }),
      message("edited-user", "user"),
      message("edited-assistant", "assistant")
    ];
    const activeSession = session(messages, {
      "earlier-group": "visible-variant"
    });
    const visibleMessages = [messages[1], messages[2], messages[3]];
    const ids = queuedIds("group-new", "variant-original", "variant-next");
    const plan = createBranchTurnPlan(
      {
        session: activeSession,
        visibleMessages,
        userIndex: 1,
        activeUser: messages[2] as ClientMessage & { role: "user" },
        activeAssistant: messages[3],
        appendUserMessage: true,
        preserveFollowingMessages: true
      },
      ids.createId
    );
    const nextUser = requestMessage("next-user", "user");

    assert.deepEqual(
      plan
        .requestHistory([], nextUser, requestMessage("assistant", "assistant"))
        .map((item) => item.id),
      ["visible", "next-user"]
    );
  });
});
