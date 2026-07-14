import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findImageInputCapableModel,
  modelLikelySupportsImageInput
} from "./modelCapabilities";

describe("modelLikelySupportsImageInput", () => {
  it("recognizes common image-capable models", () => {
    assert.equal(
      modelLikelySupportsImageInput("google/gemini-3.1-pro-preview"),
      true
    );
    assert.equal(modelLikelySupportsImageInput("openai/gpt-4.1"), true);
    assert.equal(modelLikelySupportsImageInput("openai/gpt-5.5"), true);
    assert.equal(modelLikelySupportsImageInput("anthropic/claude-3.5-sonnet"), true);
    assert.equal(modelLikelySupportsImageInput("anthropic/claude-sonnet-5"), true);
    assert.equal(modelLikelySupportsImageInput("qwen/qwen2.5-vl-72b-instruct"), true);
  });

  it("keeps text-only models off image input", () => {
    assert.equal(modelLikelySupportsImageInput("z-ai/glm-5.2"), false);
    assert.equal(modelLikelySupportsImageInput("deepseek/deepseek-chat-v3"), false);
    assert.equal(modelLikelySupportsImageInput("qwen/qwen3-coder"), false);
  });

  it("recommends the first image-capable configured model", () => {
    assert.equal(
      findImageInputCapableModel([
        "z-ai/glm-5.2",
        "google/gemini-3.1-pro-preview",
        "openai/gpt-4.1"
      ]),
      "google/gemini-3.1-pro-preview"
    );
    assert.equal(findImageInputCapableModel(["z-ai/glm-5.2"]), undefined);
  });
});
