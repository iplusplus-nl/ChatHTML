import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArtifactEdit, ClientMessage } from "../../domain/chat/sessionModel";
import {
  completeArtifactEditVariant,
  failArtifactEditVariant,
  removeArtifactEdit
} from "./artifactEditTransitions";

function edit(id: string, variantId: string): ArtifactEdit {
  return {
    id,
    createdAt: 1,
    prompt: id,
    references: [],
    status: "pending",
    activeVariantId: variantId,
    variants: [
      { id: `${variantId}-other`, createdAt: 1, status: "complete", rawStream: "other" },
      { id: variantId, createdAt: 2, status: "pending" }
    ]
  };
}

function message(): ClientMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    rawStream: "base",
    artifactEdits: [edit("edit-1", "variant-1"), edit("edit-2", "variant-2")],
    activeArtifactEditId: "edit-1"
  };
}

describe("artifact edit transitions", () => {
  it("completes only the target edit and variant", () => {
    const current = message();
    const untouchedEdit = current.artifactEdits?.[1];
    const result = completeArtifactEditVariant(current, {
      editId: "edit-1",
      variantId: "variant-1",
      rawStream: "updated",
      summary: "Updated copy",
      editCount: 2,
      baseRawStream: "base"
    });

    assert.equal(result.artifactEditBaseRawStream, "base");
    assert.equal(result.activeArtifactEditId, "edit-1");
    assert.equal(result.artifactEdits?.[0].status, "complete");
    assert.deepEqual(result.artifactEdits?.[0].variants[1], {
      id: "variant-1",
      createdAt: 2,
      status: "complete",
      rawStream: "updated",
      summary: "Updated copy",
      error: undefined,
      editCount: 2
    });
    assert.equal(result.artifactEdits?.[1], untouchedEdit);
    assert.equal(current.artifactEdits?.[0].status, "pending");
  });

  it("preserves an existing base source", () => {
    const current = { ...message(), artifactEditBaseRawStream: "original-base" };
    const result = completeArtifactEditVariant(current, {
      editId: "edit-1",
      variantId: "variant-1",
      rawStream: "updated",
      baseRawStream: "new-base"
    });

    assert.equal(result.artifactEditBaseRawStream, "original-base");
  });

  it("marks only the target edit and variant as failed", () => {
    const current = message();
    const result = failArtifactEditVariant(
      current,
      "edit-1",
      "variant-1",
      "Provider failed"
    );

    assert.equal(result.artifactEdits?.[0].status, "error");
    assert.equal(result.artifactEdits?.[0].error, "Provider failed");
    assert.equal(result.artifactEdits?.[0].variants[1].status, "error");
    assert.equal(result.artifactEdits?.[0].variants[0].status, "complete");
    assert.equal(result.artifactEdits?.[1].status, "pending");
  });

  it("removes a cancelled edit and restores the active parent", () => {
    const current = {
      ...message(),
      artifactEditBaseRawStream: "base",
      activeArtifactEditId: "edit-2"
    };
    const withParent = removeArtifactEdit(current, "edit-2", "edit-1");

    assert.deepEqual(withParent.artifactEdits?.map((item) => item.id), ["edit-1"]);
    assert.equal(withParent.artifactEditBaseRawStream, "base");
    assert.equal(withParent.activeArtifactEditId, "edit-1");

    const withoutEdits = removeArtifactEdit(withParent, "edit-1");
    assert.equal(withoutEdits.artifactEdits, undefined);
    assert.equal(withoutEdits.artifactEditBaseRawStream, undefined);
    assert.equal(withoutEdits.activeArtifactEditId, undefined);
  });
});
