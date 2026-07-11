import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSelect } from "./SettingsSelect";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("settings select", () => {
  it("renders the selected value as an accessible menu trigger", () => {
    const markup = renderToStaticMarkup(
      <SettingsSelect
        value="openai"
        ariaLabel="Provider"
        options={[
          { value: "openrouter", label: "OpenRouter" },
          {
            value: "openai",
            label: "OpenAI",
            description: "Use your own API key"
          }
        ]}
        onChange={() => undefined}
      />
    );

    assert.match(markup, /aria-label="Provider"/);
    assert.match(markup, /aria-haspopup="listbox"/);
    assert.match(markup, />OpenAI</);
    assert.doesNotMatch(markup, /<select/);
  });
});
