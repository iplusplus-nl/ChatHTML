import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCancelledAssistantPatch,
  formatChatHttpError,
  isAbortError,
  isChatCancelledMessage,
  sanitizeChatErrorMessage
} from "./chatErrors";

describe("chat errors", () => {
  it("extracts JSON and HTML error messages without exposing markup", () => {
    assert.equal(
      sanitizeChatErrorMessage('{"error":{"message":"Provider failed"}}'),
      "Provider failed"
    );
    assert.equal(
      sanitizeChatErrorMessage(
        "<!doctype html><html><head><title>Gateway Error</title></head><body><script>secret()</script></body></html>"
      ),
      "Gateway Error"
    );
    assert.equal(sanitizeChatErrorMessage(undefined, "Fallback"), "Fallback");
  });

  it("recognizes cancellation and abort errors", () => {
    assert.equal(isChatCancelledMessage("  Generation   stopped. "), true);
    assert.equal(isChatCancelledMessage("Provider stopped."), false);

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    assert.equal(isAbortError(abortError), true);
    assert.equal(isAbortError(new Error("failed")), false);
  });

  it("keeps partial visible content when a run is cancelled", () => {
    assert.deepEqual(
      createCancelledAssistantPatch(
        "<sessiontitle>Demo</sessiontitle><chat>Partial answer</chat>",
        "thinking",
        3
      ),
      {
        content: "Partial answer",
        reasoning: "thinking",
        rawStream:
          "<sessiontitle>Demo</sessiontitle><chat>Partial answer</chat>",
        streamSequence: 3,
        hasStreamUi: false,
        streamUiComplete: false,
        generationOutcome: "cancelled",
        status: "complete",
        error: undefined
      }
    );

    assert.equal(createCancelledAssistantPatch("", "", 0).content, "Generation stopped.");
  });

  it("formats HTTP status and sanitized response details", () => {
    assert.equal(
      formatChatHttpError(
        new Response(null, { status: 502, statusText: "Bad Gateway" }),
        '{"error":"Provider unavailable"}'
      ),
      "Request failed with HTTP 502 Bad Gateway. Provider unavailable"
    );
    assert.equal(
      formatChatHttpError(new Response(null, { status: 401 }), ""),
      "Request failed with HTTP 401."
    );
  });
});
