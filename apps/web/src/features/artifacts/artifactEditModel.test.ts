import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ArtifactEdit,
  ClientMessage
} from "../../domain/chat/sessionModel";
import {
  getActiveArtifactEditChain,
  getArtifactEditDisplayRawStream,
  getArtifactVersionInfo,
  getPendingArtifactEditReferences,
  getResolvedArtifactEditId
} from "./artifactEditModel";

const original = "<chat></chat><streamui><p>Original</p></streamui>";
const firstEditRaw = "<chat></chat><streamui><p>First</p></streamui>";

function edit(
  id: string,
  status: ArtifactEdit["status"],
  options: {
    parentId?: string;
    rawStream?: string;
    promptBubble?: boolean;
  } = {}
): ArtifactEdit {
  return {
    id,
    createdAt: 1,
    prompt: id,
    references: [],
    parentId: options.parentId,
    promptBubble: options.promptBubble,
    activeVariantId: `${id}-variant`,
    variants: [
      {
        id: `${id}-variant`,
        createdAt: 1,
        status,
        rawStream: options.rawStream
      }
    ],
    status
  };
}

function assistant(overrides: Partial<ClientMessage> = {}): ClientMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    rawStream: original,
    artifactEditBaseRawStream: original,
    status: "complete",
    ...overrides
  };
}

describe("artifact edit model", () => {
  it("resolves the active edit and follows its parent chain", () => {
    const edits = [
      edit("edit-1", "complete", { rawStream: firstEditRaw }),
      edit("edit-2", "pending", { parentId: "edit-1" })
    ];
    const message = assistant({
      artifactEdits: edits,
      activeArtifactEditId: "edit-2"
    });

    assert.equal(getResolvedArtifactEditId(message), "edit-2");
    assert.deepEqual(
      getActiveArtifactEditChain(message).map((item) => item.id),
      ["edit-1", "edit-2"]
    );
  });

  it("falls back to a failed edit's parent source for display", () => {
    const message = assistant({
      artifactEdits: [
        edit("edit-1", "complete", { rawStream: firstEditRaw }),
        edit("edit-2", "error", { parentId: "edit-1" })
      ],
      activeArtifactEditId: "edit-2"
    });

    assert.equal(
      getArtifactEditDisplayRawStream(message, "edit-2"),
      firstEditRaw
    );
  });

  it("disables version switching while an edit is pending", () => {
    const message = assistant({
      artifactEdits: [
        edit("edit-1", "complete", { rawStream: firstEditRaw }),
        edit("edit-2", "pending", { parentId: "edit-1" })
      ],
      activeArtifactEditId: "edit-2"
    });

    assert.deepEqual(getArtifactVersionInfo(message), {
      activeIndex: 2,
      total: 3,
      previousEditId: undefined,
      nextEditId: undefined,
      disabled: true
    });
  });

  it("deduplicates references from pending edits", () => {
    const reference = {
      kind: "element" as const,
      key: "hero",
      selector: "#hero",
      label: "Hero",
      preview: "Hero"
    };
    const pendingA = edit("edit-1", "pending");
    const pendingB = edit("edit-2", "pending");
    pendingA.references = [reference];
    pendingB.references = [reference];

    assert.deepEqual(
      getPendingArtifactEditReferences(
        assistant({ artifactEdits: [pendingA, pendingB] })
      ),
      [reference]
    );
  });
});
