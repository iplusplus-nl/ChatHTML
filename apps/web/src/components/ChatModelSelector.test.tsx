import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatModelSelector } from "./ChatModelSelector";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(reasoningSupported: boolean, reasoningEffort: "high" | "xhigh") {
  return renderToStaticMarkup(
    <ChatModelSelector
      model="z-ai/glm-5.2"
      modelOptions={["z-ai/glm-5.2", "google/gemini-3.1-pro-preview"]}
      reasoningEffort={reasoningEffort}
      reasoningSupported={reasoningSupported}
      uiComplexity={50}
      onModelChange={() => undefined}
      onReasoningEffortChange={() => undefined}
      onUiComplexityChange={() => undefined}
    />
  );
}

describe("chat model selector", () => {
  it("does not advertise reasoning when the provider path ignores it", () => {
    const markup = render(false, "high");

    assert.match(markup, /aria-haspopup="menu"/);
    assert.match(markup, /UI Balanced/);
    assert.doesNotMatch(markup, />High</);
  });

  it("labels legacy xhigh as the transmitted High level", () => {
    const markup = render(true, "xhigh");

    assert.match(markup, />High/);
    assert.doesNotMatch(markup, /Ultra|XHigh/);
  });
});
