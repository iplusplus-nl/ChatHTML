import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PopArtOnboardingDialogContent } from "./PopArtOnboardingDialog";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("Pop Art onboarding dialog", () => {
  it("explains the editable preference and offers an explicit choice", () => {
    const markup = renderToStaticMarkup(
      <PopArtOnboardingDialogContent
        onAccept={() => undefined}
        onDecline={() => undefined}
      />
    );

    assert.match(markup, /Try Pop Art Style\?/);
    assert.match(markup, /User Preference Prompt/);
    assert.match(markup, />Try Pop Art Style</);
    assert.match(markup, />Not now</);
    assert.match(markup, /- In Pop Art style/);
  });
});
