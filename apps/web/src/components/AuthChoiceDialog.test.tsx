import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthChoiceDialogContent } from "./AuthChoiceDialog";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("authentication choice dialog", () => {
  it("offers managed sign-in and a local provider path", () => {
    const markup = renderToStaticMarkup(
      <AuthChoiceDialogContent
        onClose={() => undefined}
        onSignIn={() => undefined}
        onContinueLocal={() => undefined}
      />
    );

    assert.match(markup, /Choose how to use ChatHTML/);
    assert.match(markup, />Sign in</);
    assert.match(markup, />Continue locally</);
    assert.match(markup, /OpenRouter, OpenAI, local/);
    assert.doesNotMatch(markup, /accessToken|code_verifier/);
  });
});
