import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReasoningPanelLabel } from "./ReasoningPanel";

describe("reasoning panel label", () => {
  it("does not show an ephemeral duration that disappears after reload", () => {
    assert.equal(getReasoningPanelLabel(true), "Thinking");
    assert.equal(getReasoningPanelLabel(false), "Thought");
  });
});
