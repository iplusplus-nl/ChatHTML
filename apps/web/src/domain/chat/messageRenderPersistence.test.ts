import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeRenderErrors,
  rebuildAssistantSnapshot
} from "./messageRenderPersistence";
import type { ClientMessage } from "./sessionTypes";

function assistantMessage(
  overrides: Partial<ClientMessage> = {}
): ClientMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    status: "complete",
    ...overrides
  };
}

describe("assistant render persistence", () => {
  it("preserves readability findings for later repair", () => {
    const errors = normalizeRenderErrors([
      {
        kind: "readability",
        message: "3 essential color pairs fall below the readability floor.",
        timestamp: 123
      }
    ]);

    assert.deepEqual(errors, [
      {
        kind: "readability",
        message: "3 essential color pairs fall below the readability floor.",
        timestamp: 123
      }
    ]);
  });

  it("keeps a cancelled partial stream inert while rebuilding after reload", () => {
    const restored = rebuildAssistantSnapshot(
      assistantMessage({
        rawStream:
          "<streamui><main>Partial</main><script>window.__partialRan = true</script>",
        generationOutcome: "cancelled",
        streamUiComplete: false
      })
    );

    assert.equal(restored.status, "complete");
    assert.equal(restored.streamUiComplete, false);
    assert.equal(restored.snapshot?.status, "streaming");
    assert.doesNotMatch(restored.snapshot?.completedHtml ?? "", /<script\b/i);
    assert.doesNotMatch(restored.snapshot?.iframeDocument ?? "", /__partialRan/);
  });

  it("does not activate a closed artifact when the run was cancelled or errored", () => {
    for (const generationOutcome of ["cancelled", "error"] as const) {
      const restored = rebuildAssistantSnapshot(
        assistantMessage({
          rawStream:
            "<streamui><main>Stopped</main><script>window.__terminalRan = true</script></streamui>",
          generationOutcome,
          status: generationOutcome === "error" ? "error" : "complete"
        })
      );

      assert.equal(restored.snapshot?.status, "streaming");
      assert.doesNotMatch(restored.snapshot?.completedHtml ?? "", /<script\b/i);
      assert.doesNotMatch(restored.snapshot?.iframeDocument ?? "", /__terminalRan/);
    }
  });

  it("completes a successful protocol-complete artifact", () => {
    const restored = rebuildAssistantSnapshot(
      assistantMessage({
        rawStream:
          "<streamui><main>Done</main><script>window.__completeRan = true</script></streamui>",
        generationOutcome: "complete"
      })
    );

    assert.equal(restored.streamUiComplete, true);
    assert.equal(restored.snapshot?.status, "complete");
    assert.match(restored.snapshot?.completedHtml ?? "", /<script\b/i);
    assert.match(restored.snapshot?.iframeDocument ?? "", /__completeRan/);
  });
});
