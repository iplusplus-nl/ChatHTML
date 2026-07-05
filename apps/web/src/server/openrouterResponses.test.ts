import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractResponsesOutputText } from "../../server/openrouter.js";

describe("openrouter response stream helpers", () => {
  it("extracts final output text from a completed Responses payload", () => {
    const text = extractResponsesOutputText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "Hello" },
            { type: "output_text", text: " world" }
          ]
        }
      ]
    });

    assert.equal(text, "Hello world");
  });

  it("ignores tool calls while extracting final output text", () => {
    const text = extractResponsesOutputText({
      output: [
        {
          type: "function_call",
          name: "retrieve",
          call_id: "call-1",
          arguments: "{}"
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "Final answer" }]
        }
      ]
    });

    assert.equal(text, "Final answer");
  });
});
