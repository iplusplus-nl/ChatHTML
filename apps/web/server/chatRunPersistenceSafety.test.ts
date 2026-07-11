import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPersistGeneratedArtifactBatch,
  finalizeGeneratedArtifactBatchPatch,
  getGeneratedArtifactBatchIdentity
} from "./generatedArtifactBatchPersistence.js";
import {
  buildChatRunMessagePatch,
  canPersistChatRunMessage,
  normalizeSessionMessageInput
} from "./chatRunRequestModel.js";
import { selectPresentSessionMessagePatch } from "./sessions.js";

function pendingMessage(operationId = "operation-1", createdAt = 10) {
  return {
    id: "assistant-1",
    role: "assistant" as const,
    content: "",
    generationRunId: "run-1",
    artifactEditBaseRawStream: "<chat>Base</chat>",
    artifactEdits: [
      {
        id: "edit-1",
        origin: "chat-run",
        createdAt,
        prompt: "Regenerate",
        references: [],
        activeVariantId: "variant-1",
        variants: [
          {
            id: "variant-1",
            operationId,
            createdAt,
            status: "pending"
          }
        ],
        status: "pending"
      }
    ],
    activeArtifactEditId: "edit-1",
    status: "streaming" as const
  };
}

describe("chat run persistence compare-and-swap", () => {
  it("clears streaming outcomes and marks every terminal outcome", () => {
    const streaming = buildChatRunMessagePatch(
      "partial",
      "",
      "streaming",
      1,
      "run-1"
    );
    const complete = buildChatRunMessagePatch(
      "done",
      "",
      "complete",
      2,
      "run-1",
      undefined,
      "complete"
    );
    const failed = buildChatRunMessagePatch(
      "",
      "",
      "error",
      2,
      "run-1",
      "Provider failed",
      "error"
    );
    const cancelled = buildChatRunMessagePatch(
      "",
      "",
      "complete",
      2,
      "run-1",
      "Generation stopped.",
      "cancelled"
    );

    assert.equal(Object.hasOwn(streaming, "generationOutcome"), true);
    assert.equal(streaming.generationOutcome, undefined);
    assert.equal(complete.generationOutcome, "complete");
    assert.equal(failed.generationOutcome, "error");
    assert.equal(failed.error, "Provider failed");
    assert.equal(cancelled.generationOutcome, "cancelled");
    assert.equal(cancelled.content, "Generation stopped.");
    assert.equal(cancelled.error, undefined);
  });

  it("requires the current run and the complete artifact operation token", () => {
    const original = pendingMessage();
    const identity = getGeneratedArtifactBatchIdentity(original);
    assert.ok(identity);

    assert.equal(
      canPersistGeneratedArtifactBatch(original, "run-1", identity),
      true
    );
    assert.equal(
      canPersistGeneratedArtifactBatch(original, "newer-run", identity),
      false
    );
    assert.equal(
      canPersistGeneratedArtifactBatch(
        pendingMessage("newer-operation", 10),
        "run-1",
        identity
      ),
      false
    );
    assert.equal(
      canPersistGeneratedArtifactBatch(
        pendingMessage("operation-1", 11),
        "run-1",
        identity
      ),
      false
    );
  });

  it("does not let an older ordinary run overwrite a replacement", () => {
    assert.equal(
      canPersistChatRunMessage(
        { generationRunId: "run-2" },
        "run-1"
      ),
      false
    );
    assert.equal(
      canPersistChatRunMessage(
        { generationRunId: "run-1" },
        "run-1"
      ),
      true
    );
  });

  it("does not build a stale terminal patch for a replaced operation", () => {
    const identity = getGeneratedArtifactBatchIdentity(pendingMessage());
    assert.ok(identity);
    const patch = {
      content: "New result",
      rawStream: "<chat>New result</chat>",
      status: "complete" as const
    };

    const result = finalizeGeneratedArtifactBatchPatch({
      assistantMessage: pendingMessage("replacement-operation", 12),
      patch,
      status: "complete",
      expectedIdentity: identity
    });

    assert.equal(result, patch);
  });
});

describe("existing message initial persistence", () => {
  it("normalizes only fields the request actually carries", () => {
    const normalized = normalizeSessionMessageInput({
      id: "assistant-1",
      role: "assistant",
      content: "",
      rawStream: "",
      artifactEdits: pendingMessage().artifactEdits,
      activeArtifactEditId: "edit-1",
      branchRunRollback: {
        runId: " run-1 ",
        groupId: " group-1 ",
        variantId: " variant-2 ",
        fallbackVariantId: " variant-1 "
      },
      generationOutcome: "complete"
    });
    assert.ok(normalized);

    assert.equal(Object.hasOwn(normalized, "content"), true);
    assert.equal(Object.hasOwn(normalized, "rawStream"), true);
    assert.equal(Object.hasOwn(normalized, "artifactEdits"), true);
    assert.equal(Object.hasOwn(normalized, "branchGroupId"), false);
    assert.equal(Object.hasOwn(normalized, "branchVariantId"), false);
    assert.equal(Object.hasOwn(normalized, "branchAnchor"), false);
    assert.deepEqual(normalized.branchRunRollback, {
      runId: "run-1",
      groupId: "group-1",
      variantId: "variant-2",
      fallbackVariantId: "variant-1"
    });
    assert.equal(Object.hasOwn(normalized, "fileIds"), false);
    assert.equal(Object.hasOwn(normalized, "artifactContext"), false);
    assert.equal(Object.hasOwn(normalized, "runtimeErrors"), false);
    assert.equal(normalized.generationOutcome, "complete");
  });

  it("retains explicit clears while preserving every omitted field", () => {
    const input = normalizeSessionMessageInput({
      id: "assistant-1",
      role: "assistant",
      content: "",
      rawStream: "",
      reasoning: null,
      branchAnchor: false,
      artifactEdits: pendingMessage().artifactEdits,
      activeArtifactEditId: "edit-1",
      generationRunId: "run-1",
      generationOutcome: null,
      status: "streaming"
    });
    assert.ok(input);
    const patch = selectPresentSessionMessagePatch(input, input);
    const current = {
      content: "Existing content",
      rawStream: "<chat>Existing content</chat>",
      reasoning: "Existing reasoning",
      branchGroupId: "branch-group",
      branchVariantId: "branch-variant",
      branchAnchor: true,
      branchRunRollback: {
        runId: "run-1",
        groupId: "branch-group",
        variantId: "branch-variant"
      },
      fileIds: ["file-1"],
      artifactContext: { textSummary: "Existing artifact" },
      runtimeErrors: [{ message: "Existing runtime error" }]
    };
    const merged = { ...current, ...patch };

    assert.equal(Object.hasOwn(patch, "reasoning"), true);
    assert.equal(patch.reasoning, undefined);
    assert.equal(Object.hasOwn(patch, "branchAnchor"), true);
    assert.equal(patch.branchAnchor, undefined);
    assert.equal(Object.hasOwn(patch, "generationOutcome"), true);
    assert.equal(patch.generationOutcome, undefined);
    assert.equal(merged.branchGroupId, "branch-group");
    assert.equal(merged.branchVariantId, "branch-variant");
    assert.deepEqual(merged.branchRunRollback, current.branchRunRollback);
    assert.deepEqual(merged.fileIds, ["file-1"]);
    assert.deepEqual(merged.artifactContext, {
      textSummary: "Existing artifact"
    });
    assert.deepEqual(merged.runtimeErrors, [
      { message: "Existing runtime error" }
    ]);
  });

  it("keeps branch rollback metadata when terminal stream patches merge", () => {
    const branchRunRollback = {
      runId: "run-1",
      groupId: "group-1",
      variantId: "variant-2",
      fallbackVariantId: "variant-1"
    };
    const terminalPatch = buildChatRunMessagePatch(
      "partial",
      "",
      "complete",
      5,
      "run-1",
      undefined,
      "cancelled"
    );
    const merged = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "",
      generationRunId: "run-1",
      branchRunRollback,
      ...terminalPatch
    };

    assert.equal(
      Object.hasOwn(terminalPatch, "branchRunRollback"),
      false
    );
    assert.deepEqual(merged.branchRunRollback, branchRunRollback);
    assert.equal(merged.generationOutcome, "cancelled");
  });
});
