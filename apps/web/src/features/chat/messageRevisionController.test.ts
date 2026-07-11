import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ChatSession,
  ClientMessage,
  SessionState
} from "../../domain/chat/sessionModel";
import type { RenderSnapshot } from "../../runtime/streamui/types";
import {
  createMessageRevisionController,
  type MessageRevisionBranchInput
} from "./messageRevisionController";

const completeSnapshot: RenderSnapshot = {
  raw: "<p>complete</p>",
  completedHtml: "<p>complete</p>",
  iframeDocument: "",
  errors: [],
  status: "complete"
};

function state(messages: ClientMessage[]): SessionState {
  const session: ChatSession = {
    id: "session-1",
    title: "Session",
    createdAt: 1,
    updatedAt: 1,
    messages,
    files: []
  };
  return { sessions: [session], activeSessionId: session.id };
}

function harness(messages: ClientMessage[]) {
  const events: Array<{ type: string; value: unknown }> = [];
  let current = state(messages);
  const controller = createMessageRevisionController({
    getState: () => current,
    getActiveSessionId: () => current.activeSessionId,
    regenerateArtifactEdit: (assistantId, editId) =>
      events.push({ type: "artifact-edit", value: { assistantId, editId } }),
    startGeneratedArtifactBatch: (input) =>
      events.push({ type: "generated-batch", value: input }),
    startVisualRepair: (assistantId, snapshot, width) =>
      events.push({ type: "visual-repair", value: { assistantId, snapshot, width } }),
    startBranchedTurn: (input) =>
      events.push({ type: "branch", value: input })
  });
  return {
    controller,
    events,
    setState(next: SessionState) {
      current = next;
    }
  };
}

const user: ClientMessage = {
  id: "user-1",
  role: "user",
  content: "Original prompt",
  status: "complete"
};
const assistant: ClientMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "Reply",
  status: "complete"
};

describe("message revision controller", () => {
  it("regenerates the active artifact edit before other routes", () => {
    const test = harness([
      user,
      {
        ...assistant,
        activeArtifactEditId: "edit-1",
        artifactEdits: [
          {
            id: "edit-1",
            createdAt: 1,
            prompt: "edit",
            references: [],
            variants: [],
            status: "complete"
          }
        ]
      }
    ]);

    test.controller.regenerateAssistant("assistant-1");

    assert.deepEqual(test.events, [
      {
        type: "artifact-edit",
        value: { assistantId: "assistant-1", editId: "edit-1" }
      }
    ]);
  });

  it("routes persisted artifact history through generated batch", () => {
    const test = harness([
      user,
      { ...assistant, artifactEditBaseRawStream: "<p>base</p>" }
    ]);

    test.controller.regenerateAssistant("assistant-1");

    assert.equal(test.events[0].type, "generated-batch");
    assert.deepEqual(test.events[0].value, {
      sessionId: "session-1",
      assistantId: "assistant-1",
      sourceUserMessageId: "user-1",
      prompt: "Original prompt",
      initialReasoning: "Thinking"
    });
  });

  it("uses the active or original completed snapshot for visual repair", () => {
    const original: ClientMessage = {
      ...assistant,
      id: "original",
      snapshot: completeSnapshot
    };
    const test = harness([
      user,
      original,
      {
        ...assistant,
        repairOfMessageId: "original"
      }
    ]);

    test.controller.regenerateAssistant("assistant-1");

    assert.deepEqual(test.events, [
      {
        type: "visual-repair",
        value: {
          assistantId: "assistant-1",
          snapshot: completeSnapshot,
          width: 900
        }
      }
    ]);
  });

  it("falls back to a normal branch regeneration", () => {
    const test = harness([user, assistant]);

    test.controller.regenerateAssistant("assistant-1");

    const branch = test.events[0].value as MessageRevisionBranchInput;
    assert.equal(test.events[0].type, "branch");
    assert.equal(branch.userIndex, 0);
    assert.equal(branch.assistantId, "assistant-1");
    assert.equal(branch.nextUserContent, "Original prompt");
  });

  it("edits a user turn as a history-preserving branch", () => {
    const test = harness([user, assistant]);

    test.controller.editUserMessage("user-1", "  Revised prompt  ");

    const branch = test.events[0].value as MessageRevisionBranchInput;
    assert.equal(branch.nextUserContent, "Revised prompt");
    assert.equal(branch.assistantId, "assistant-1");
    assert.equal(branch.preserveFollowingMessages, true);
  });

  it("ignores missing, blank, and unchanged revision targets", () => {
    const test = harness([user, assistant]);

    test.controller.regenerateAssistant("missing");
    test.controller.editUserMessage("missing", "changed");
    test.controller.editUserMessage("user-1", "   ");
    test.controller.editUserMessage("user-1", " Original prompt ");

    assert.deepEqual(test.events, []);
  });

  it("reads the latest state for every action", () => {
    const test = harness([user, assistant]);
    test.setState(state([]));

    test.controller.regenerateAssistant("assistant-1");
    test.controller.editUserMessage("user-1", "changed");

    assert.deepEqual(test.events, []);
  });
});
