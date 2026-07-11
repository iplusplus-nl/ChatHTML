import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatSession, ClientMessage } from "./sessionModel";
import {
  compactCancelledBranchRuns,
  discardUnacceptedBranchRun,
  getValidBranchRunRollback,
  isCancelledBranchRunTombstone
} from "./branchRunLifecycle";

function message(
  id: string,
  role: ClientMessage["role"],
  variantId?: string
): ClientMessage {
  return {
    id,
    role,
    content: id,
    ...(variantId
      ? { branchGroupId: "group-1", branchVariantId: variantId }
      : {})
  };
}

function branchAssistant(
  outcome: ClientMessage["generationOutcome"] = "cancelled",
  overrides: Partial<ClientMessage> = {}
): ClientMessage {
  return {
    ...message("assistant-new", "assistant", "variant-new"),
    generationRunId: "run-new",
    generationOutcome: outcome,
    status: outcome === "error" ? "error" : "complete",
    branchAnchor: true,
    branchRunRollback: {
      runId: "run-new",
      groupId: "group-1",
      variantId: "variant-new",
      fallbackVariantId: "variant-old"
    },
    ...overrides
  };
}

function session(
  assistant = branchAssistant(),
  selection = "variant-new"
): ChatSession {
  return {
    id: "session-1",
    title: "Session",
    createdAt: 1,
    updatedAt: 1,
    branchSelections: { "group-1": selection },
    messages: [
      message("user-old", "user", "variant-old"),
      message("assistant-old", "assistant", "variant-old"),
      message("user-new", "user", "variant-new"),
      assistant,
      message("other", "assistant")
    ],
    files: []
  };
}

describe("branch run lifecycle", () => {
  it("compacts a cancelled variant to a durable minimal tombstone", () => {
    const current = session(
      branchAssistant("cancelled", {
        rawStream: "partial",
        reasoning: "thinking",
        streamSequence: 4
      })
    );
    const compacted = compactCancelledBranchRuns(current);

    assert.deepEqual(
      compacted.messages.map((item) => item.id),
      ["user-old", "assistant-old", "assistant-new", "other"]
    );
    assert.deepEqual(compacted.messages[2], {
      id: "assistant-new",
      role: "assistant",
      content: "",
      generationRunId: "run-new",
      streamSequence: 4,
      generationOutcome: "cancelled",
      status: "complete",
      branchRunRollback: {
        runId: "run-new",
        groupId: "group-1",
        variantId: "variant-new",
        fallbackVariantId: "variant-old"
      }
    });
    assert.equal(compacted.branchSelections?.["group-1"], "variant-old");
    assert.equal(isCancelledBranchRunTombstone(compacted.messages[2]), true);
    assert.equal(compactCancelledBranchRuns(compacted), compacted);
  });

  it("keeps streaming, complete, and error branch runs intact", () => {
    for (const assistant of [
      branchAssistant(undefined, {
        generationOutcome: undefined,
        status: "streaming"
      }),
      branchAssistant("complete"),
      branchAssistant("error")
    ]) {
      const current = session(assistant);
      assert.equal(compactCancelledBranchRuns(current), current);
    }
  });

  it("falls back to the first live variant or removes an empty selection", () => {
    const invalidFallback = session(
      branchAssistant("cancelled", {
        branchRunRollback: {
          runId: "run-new",
          groupId: "group-1",
          variantId: "variant-new",
          fallbackVariantId: "missing"
        }
      })
    );
    assert.equal(
      compactCancelledBranchRuns(invalidFallback).branchSelections?.["group-1"],
      "variant-old"
    );

    const onlyVariant = session();
    onlyVariant.messages = onlyVariant.messages.filter(
      (item) => item.branchVariantId !== "variant-old"
    );
    assert.equal(
      compactCancelledBranchRuns(onlyVariant).branchSelections,
      undefined
    );
  });

  it("does not roll back a completed branch when a later run reuses its assistant", () => {
    const reused = branchAssistant("cancelled", {
      generationRunId: "artifact-run",
      branchRunRollback: {
        runId: "branch-run",
        groupId: "group-1",
        variantId: "variant-new",
        fallbackVariantId: "variant-old"
      }
    });

    const current = session(reused);
    assert.equal(getValidBranchRunRollback(reused), undefined);
    assert.equal(compactCancelledBranchRuns(current), current);
  });

  it("discards an unaccepted branch without leaving a tombstone", () => {
    const current = session(
      branchAssistant(undefined, {
        generationOutcome: undefined,
        status: "streaming"
      })
    );
    const discarded = discardUnacceptedBranchRun(current, {
      runId: "run-new",
      assistantId: "assistant-new"
    });

    assert.deepEqual(
      discarded.messages.map((item) => item.id),
      ["user-old", "assistant-old", "other"]
    );
    assert.equal(discarded.branchSelections?.["group-1"], "variant-old");
  });
});
