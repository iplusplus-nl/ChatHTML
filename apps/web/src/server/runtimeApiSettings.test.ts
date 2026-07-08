import assert from "node:assert/strict";
import test from "node:test";
import {
  getRuntimeApiDefaults,
  readRuntimeApiCredentials
} from "../../server/runtimeApiSettings.js";

test("runtime defaults include the required model shortlist", () => {
  const defaults = getRuntimeApiDefaults();

  assert.deepEqual(defaults.modelOptions.slice(0, 4), [
    "openai/gpt-5.5",
    "google/gemini-3.1-pro-preview",
    "anthropic/claude-sonnet-5",
    "z-ai/glm-5.2"
  ]);
  assert.equal(defaults.uiComplexity, 50);
});

test("managed ChatHTML Cloud settings fall back to open runtime credentials", () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";

  try {
    const credentials = readRuntimeApiCredentials({
      providerId: "chathtml-cloud",
      apiKeySource: "managed",
      apiKey: "",
      baseUrl: "",
      providerName: "ChatHTML Cloud"
    });

    assert.equal(credentials.providerName, "OpenRouter");
    assert.equal(credentials.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(credentials.apiKeySource, "environment");
    assert.equal(credentials.apiKeyEnvironmentName, "OPENROUTER_API_KEY");
    assert.equal(credentials.apiKey, "test-openrouter-key");
  } finally {
    if (previousKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousKey;
    }
  }
});
