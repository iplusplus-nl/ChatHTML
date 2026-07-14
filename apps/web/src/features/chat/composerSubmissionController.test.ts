import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArtifactSelection } from "../../core/artifactSelection";
import type { ImageAttachment } from "../../core/imageAttachments";
import {
  submitComposerMessage,
  type ComposerSubmissionPorts
} from "./composerSubmissionController";

const selection: ArtifactSelection = {
  id: "selection-1",
  messageId: "assistant-1",
  createdAt: 1,
  kind: "element",
  key: "hero",
  selector: "#hero",
  label: "Hero",
  preview: "Hero"
};

const attachment: ImageAttachment = {
  id: "image-1",
  name: "reference.png",
  mimeType: "image/png",
  size: 4,
  dataUrl: "data:image/png;base64,AAAA"
};

function harness(started = true) {
  const calls: string[] = [];
  const ports: ComposerSubmissionPorts = {
    getSelections: () => [selection],
    runSourceEdit: async () => {
      calls.push("source-edit");
    },
    startArtifactGeneration: () => {
      calls.push("artifact-generation");
      return started;
    },
    sendChat: async () => {
      calls.push("chat");
    }
  };
  return {
    calls,
    ports
  };
}

describe("composer submission routing", () => {
  it("routes a selected artifact with an image through multimodal generation", async () => {
    const test = harness();

    assert.equal(
      await submitComposerMessage("Match this reference", [attachment], test.ports),
      "artifact-generation"
    );
    assert.deepEqual(test.calls, ["artifact-generation"]);
  });

  it("falls back to a chat request when a selected artifact is stale", async () => {
    const test = harness(false);

    assert.equal(
      await submitComposerMessage("Keep the image", [attachment], test.ports),
      "chat"
    );
    assert.deepEqual(test.calls, ["artifact-generation", "chat"]);
  });

  it("falls back when generation reports an asynchronous preflight refusal", async () => {
    const test = harness();
    test.ports.startArtifactGeneration = async () => {
      test.calls.push("artifact-generation");
      await Promise.resolve();
      return false;
    };

    assert.equal(
      await submitComposerMessage("Keep the image", [attachment], test.ports),
      "chat"
    );
    assert.deepEqual(test.calls, ["artifact-generation", "chat"]);
  });

  it("keeps attachment-free artifact edits on the source-edit path", async () => {
    const test = harness();

    assert.equal(
      await submitComposerMessage("Change the heading", [], test.ports),
      "artifact-edit"
    );
    assert.deepEqual(test.calls, ["source-edit"]);
  });
});
