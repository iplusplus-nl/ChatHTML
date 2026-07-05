import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractStreamUiParts } from "./protocol";

describe("extractStreamUiParts", () => {
  it("separates title, chat, and streamui content", () => {
    const parts = extractStreamUiParts(
      "<sessiontitle>Demo</sessiontitle><chat>Hello</chat><streamui><p>Hi</p></streamui>"
    );

    assert.equal(parts.sessionTitle, "Demo");
    assert.equal(parts.chat, "Hello");
    assert.equal(parts.streamui, "<p>Hi</p>");
    assert.equal(parts.sessionTitleComplete, true);
    assert.equal(parts.hasChat, true);
    assert.equal(parts.hasStreamUi, true);
    assert.equal(parts.streamUiComplete, true);
  });

  it("keeps partial streamui content while streaming", () => {
    const parts = extractStreamUiParts(
      "<chat></chat><streamui><section><p>Loading"
    );

    assert.equal(parts.hasStreamUi, true);
    assert.equal(parts.streamUiComplete, false);
    assert.equal(parts.streamui, "<section><p>Loading");
  });

  it("accepts protocol tags with attributes", () => {
    const parts = extractStreamUiParts(
      '<sessiontitle data-x="1">Demo</sessiontitle><chat role="note"></chat><streamui data-kind="reply"><p>Hi</p></streamui>'
    );

    assert.equal(parts.sessionTitle, "Demo");
    assert.equal(parts.hasChat, true);
    assert.equal(parts.hasStreamUi, true);
    assert.equal(parts.streamUiComplete, true);
    assert.equal(parts.streamui, "<p>Hi</p>");
  });

  it("removes protocol tags accidentally emitted inside streamui", () => {
    const parts = extractStreamUiParts(
      "<streamui><chat>ignore</chat><p>Keep</p><sessiontitle>ignore</sessiontitle></streamui>"
    );

    assert.equal(parts.streamui, "ignore<p>Keep</p>");
  });

  it("uses plain fallback text when no streamui block exists", () => {
    const parts = extractStreamUiParts("Plain answer");

    assert.equal(parts.hasStreamUi, false);
    assert.equal(parts.fallbackText, "Plain answer");
  });
});
