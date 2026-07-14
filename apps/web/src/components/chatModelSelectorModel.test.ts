import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_REASONING_OPTIONS,
  getChatReasoningIndex,
  getChatReasoningLabel,
  getViewportHorizontalOffset,
  getViewportVerticalOffset
} from "./chatModelSelectorModel";

describe("chat model selector reasoning model", () => {
  it("labels and maps minimal reasoning as Minimal", () => {
    const index = getChatReasoningIndex("minimal");

    assert.equal(getChatReasoningLabel("minimal"), "Minimal");
    assert.equal(CHAT_REASONING_OPTIONS[index].value, "minimal");
    assert.equal(CHAT_REASONING_OPTIONS[index].label, "Minimal");
  });

  it("keeps Off as the display fallback only for none", () => {
    assert.equal(getChatReasoningLabel("none"), "");
    assert.equal(CHAT_REASONING_OPTIONS[getChatReasoningIndex("none")].value, "none");
    assert.notEqual(getChatReasoningIndex("none"), getChatReasoningIndex("minimal"));
    assert.equal(getChatReasoningLabel("low"), "Low");
  });

  it("maps legacy xhigh to the actual transmitted High level", () => {
    assert.equal(getChatReasoningLabel("xhigh"), "High");
    assert.equal(
      CHAT_REASONING_OPTIONS[getChatReasoningIndex("xhigh")].value,
      "high"
    );
    assert.equal(CHAT_REASONING_OPTIONS.some((option) => option.label === "Ultra"), false);
  });

  it("calculates a viewport correction for menus that collide with an edge", () => {
    assert.equal(getViewportHorizontalOffset(-24, 256, 320), 36);
    assert.equal(getViewportHorizontalOffset(28, 348, 360), 0);
    assert.equal(getViewportHorizontalOffset(100, 410, 390), -32);
    assert.equal(getViewportVerticalOffset(-165, 344, 568), 177);
    assert.equal(getViewportVerticalOffset(24, 344, 568), 0);
  });
});
