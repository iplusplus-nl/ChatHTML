import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldCompleteArtifactRender } from "./artifactRenderCompletionPolicy";

describe("artifact render completion policy", () => {
  it("completes only a protocol-complete successful response", () => {
    assert.equal(
      shouldCompleteArtifactRender({
        status: "complete",
        generationOutcome: "complete",
        streamUiComplete: true
      }),
      true
    );
    assert.equal(
      shouldCompleteArtifactRender({
        status: "complete",
        streamUiComplete: true
      }),
      true
    );
  });

  it("keeps partial, cancelled, errored, and active responses inert", () => {
    const unsafeStates = [
      {
        status: "complete" as const,
        generationOutcome: "cancelled" as const,
        streamUiComplete: false
      },
      {
        status: "complete" as const,
        generationOutcome: "cancelled" as const,
        streamUiComplete: true
      },
      {
        status: "error" as const,
        generationOutcome: "error" as const,
        streamUiComplete: true
      },
      {
        status: "streaming" as const,
        generationOutcome: undefined,
        streamUiComplete: true
      },
      {
        status: "complete" as const,
        generationOutcome: "complete" as const,
        streamUiComplete: false
      }
    ];

    for (const state of unsafeStates) {
      assert.equal(shouldCompleteArtifactRender(state), false);
    }
  });
});
