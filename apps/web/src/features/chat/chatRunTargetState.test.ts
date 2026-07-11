import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ChatSession,
  ClientMessage,
  SessionState
} from "../../domain/chat/sessionModel";
import {
  prepareGeneratedArtifactBatch,
  getGeneratedArtifactBatchAssistantPatch
} from "../artifacts/generatedArtifactBatchModel";
import {
  applyAuthoritativeChatRunResult,
  getStreamingChatRunTargets
} from "./chatRunTargetState";

const target = {
  runId: "run-1",
  sessionId: "session-1",
  assistantId: "assistant-1"
};

function assistant(
  overrides: Partial<ClientMessage> = {}
): ClientMessage {
  return {
    id: target.assistantId,
    role: "assistant",
    content: "partial",
    rawStream: "partial",
    reasoning: "thinking",
    streamSequence: 3,
    generationRunId: target.runId,
    status: "streaming",
    ...overrides
  };
}

function session(message = assistant()): ChatSession {
  return {
    id: target.sessionId,
    title: "Session",
    createdAt: 1,
    updatedAt: 1,
    messages: [message],
    files: []
  };
}

function state(message = assistant()): SessionState {
  return { activeSessionId: target.sessionId, sessions: [session(message)] };
}

describe("chat run target state", () => {
  it("discovers exact streaming targets only", () => {
    const current = session();
    current.messages.push(
      assistant({ id: "done", generationRunId: "run-done", status: "complete" }),
      { id: "user", role: "user", content: "hello", status: "streaming" }
    );

    assert.deepEqual(getStreamingChatRunTargets(current), [target]);
    assert.deepEqual(getStreamingChatRunTargets(undefined), []);
  });

  it("applies a cancelled fallback to the exact target only", () => {
    const initial = state();
    const next = applyAuthoritativeChatRunResult(
      initial,
      target,
      { runId: target.runId, outcome: "cancelled", transitioned: true },
      undefined,
      "day",
      50
    );
    const message = next.sessions[0].messages[0];

    assert.notEqual(next, initial);
    assert.equal(message.generationOutcome, "cancelled");
    assert.equal(message.status, "complete");
    assert.equal(message.rawStream, "partial");
    assert.equal(next.sessions[0].updatedAt, 50);

    assert.equal(
      applyAuthoritativeChatRunResult(
        initial,
        { ...target, runId: "wrong" },
        { runId: "wrong", outcome: "cancelled", transitioned: true },
        undefined,
        "day"
      ),
      initial
    );
  });

  it("requires an exact server message for complete and error", () => {
    for (const outcome of ["complete", "error"] as const) {
      const initial = state();
      const result = { runId: target.runId, outcome, transitioned: false };
      const missing = applyAuthoritativeChatRunResult(
        initial,
        target,
        result,
        undefined,
        "day"
      );
      const exact = applyAuthoritativeChatRunResult(
        initial,
        target,
        result,
        assistant({
          content: outcome,
          generationOutcome: outcome,
          status: outcome,
          error: outcome === "error" ? "failed" : undefined
        }),
        "day"
      );

      assert.equal(missing, initial);
      assert.notEqual(exact, initial);
      assert.equal(exact.sessions[0].messages[0].generationOutcome, outcome);
      assert.equal(exact.sessions[0].messages[0].status, outcome);
    }
  });

  it("rolls back a generated artifact batch through the same cancelled path", () => {
    const source = assistant({
      content: "Artifact",
      rawStream: "<streamui><main>Old</main></streamui>",
      status: "complete",
      generationRunId: undefined,
      generationOutcome: undefined
    });
    const operation = prepareGeneratedArtifactBatch(source, {
      ...target,
      sourceUserMessageId: "user-1",
      prompt: "repair",
      operationId: "operation-1",
      editId: "edit-1",
      variantId: "variant-1",
      createdAt: 10
    });
    assert.ok(operation);
    const pendingPatch = getGeneratedArtifactBatchAssistantPatch(
      source,
      operation,
      "day"
    );
    assert.ok(pendingPatch);
    const running = {
      ...source,
      ...pendingPatch,
      generationRunId: target.runId,
      status: "streaming" as const
    };

    const next = applyAuthoritativeChatRunResult(
      state(running),
      target,
      { runId: target.runId, outcome: "cancelled", transitioned: true },
      undefined,
      "day"
    );
    const cancelled = next.sessions[0].messages[0];

    assert.equal(cancelled.generationOutcome, "cancelled");
    assert.equal(cancelled.status, "complete");
    assert.equal(cancelled.rawStream, source.rawStream);
    assert.equal(
      cancelled.artifactEdits?.some((edit) => edit.status === "pending") ?? false,
      false
    );
  });

  it("compacts an authoritative cancelled branch to its fallback", () => {
    const branchAssistant = assistant({
      branchGroupId: "group-1",
      branchVariantId: "variant-new",
      branchAnchor: true,
      branchRunRollback: {
        runId: target.runId,
        groupId: "group-1",
        variantId: "variant-new",
        fallbackVariantId: "variant-old"
      }
    });
    const branchSession: ChatSession = {
      ...session(branchAssistant),
      branchSelections: { "group-1": "variant-new" },
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "old",
          branchGroupId: "group-1",
          branchVariantId: "variant-old"
        },
        {
          id: "old-assistant",
          role: "assistant",
          content: "old",
          branchGroupId: "group-1",
          branchVariantId: "variant-old"
        },
        {
          id: "new-user",
          role: "user",
          content: "new",
          branchGroupId: "group-1",
          branchVariantId: "variant-new"
        },
        branchAssistant
      ]
    };

    const next = applyAuthoritativeChatRunResult(
      { activeSessionId: target.sessionId, sessions: [branchSession] },
      target,
      { runId: target.runId, outcome: "cancelled", transitioned: true },
      undefined,
      "day",
      20
    );

    assert.deepEqual(
      next.sessions[0].messages.map((message) => message.id),
      ["old-user", "old-assistant", target.assistantId]
    );
    assert.equal(next.sessions[0].messages[2].content, "");
    assert.equal(next.sessions[0].messages[2].branchGroupId, undefined);
    assert.equal(
      next.sessions[0].branchSelections?.["group-1"],
      "variant-old"
    );
  });
});
