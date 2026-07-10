import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getThinkingActivityPanelModel } from "./ThinkingActivityPanel";

describe("thinking activity panel model", () => {
  it("describes an active reasoning stream", () => {
    assert.deepEqual(
      getThinkingActivityPanelModel({
        status: "streaming",
        reasoning: "  Inspecting the request.  "
      }),
      {
        reasoning: "Inspecting the request.",
        isStreaming: true,
        headerStatus: "Thinking",
        stepTitle: "Thinking",
        stepStatus: "In progress"
      }
    );
  });

  it("describes completed reasoning", () => {
    assert.deepEqual(
      getThinkingActivityPanelModel({
        status: "complete",
        reasoning: "Compared the alternatives."
      }),
      {
        reasoning: "Compared the alternatives.",
        isStreaming: false,
        headerStatus: "Complete",
        stepTitle: "Thought",
        stepStatus: "Complete"
      }
    );
  });

  it("removes synthetic reasoning status text", () => {
    const model = getThinkingActivityPanelModel({
      status: "streaming",
      reasoning: "Generating..."
    });

    assert.equal(model.reasoning, "");
  });
});
