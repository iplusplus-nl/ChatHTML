import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_API_SETTINGS,
  REQUIRED_MODEL_OPTIONS,
  normalizeApiSettings
} from "../../core/apiSettings";
import {
  addSettingsModelOptions,
  applyImportedUserPreferences,
  changeSettingsBaseUrl,
  changeSettingsProvider,
  getExportedUserPreferences,
  removeSettingsModelOption,
  toggleSettingsModelSelection
} from "./settingsDraftModel";

describe("settings draft model", () => {
  it("moves the models endpoint with a base URL while it follows the default", () => {
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      baseUrl: "https://old.example/v1",
      modelsEndpoint: "https://old.example/v1/models"
    });

    const next = changeSettingsBaseUrl(current, "https://new.example/v2/");

    assert.equal(next.baseUrl, "https://new.example/v2/");
    assert.equal(next.modelsEndpoint, "https://new.example/v2/models");
  });

  it("preserves a custom models endpoint when the base URL changes", () => {
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      baseUrl: "https://old.example/v1",
      modelsEndpoint: "https://catalog.example/models"
    });

    const next = changeSettingsBaseUrl(current, "https://new.example/v1");

    assert.equal(next.modelsEndpoint, "https://catalog.example/models");
  });

  it("applies a provider preset while preserving an ordinary API key", () => {
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      providerId: "custom",
      apiKeySource: "manual",
      apiKey: "secret",
      model: "custom-model"
    });

    const next = changeSettingsProvider(current, "openai");

    assert.equal(next.providerId, "openai");
    assert.equal(next.providerName, "OpenAI");
    assert.equal(next.baseUrl, "https://api.openai.com/v1");
    assert.equal(next.modelsEndpoint, "https://api.openai.com/v1/models");
    assert.equal(next.model, "gpt-4.1");
    assert.equal(next.reasoningEffort, "none");
    assert.equal(next.apiKeySource, "manual");
    assert.equal(next.apiKey, "secret");
  });

  it("forces managed provider credentials and clears a manual key", () => {
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      apiKeySource: "manual",
      apiKey: "secret"
    });

    const next = changeSettingsProvider(current, "chathtml-cloud");

    assert.equal(next.apiKeySource, "managed");
    assert.equal(next.apiKey, "");
  });

  it("toggles fetched model selection case-insensitively", () => {
    assert.deepEqual(toggleSettingsModelSelection([], "Vendor/Model"), [
      "Vendor/Model"
    ]);
    assert.deepEqual(
      toggleSettingsModelSelection(["Vendor/Model"], "vendor/model"),
      []
    );
  });

  it("does not toggle or remove required models", () => {
    const required = REQUIRED_MODEL_OPTIONS[0];
    const selected = ["custom/model"];
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      model: required
    });

    assert.equal(toggleSettingsModelSelection(selected, required), selected);
    assert.equal(removeSettingsModelOption(current, required), current);
  });

  it("adds fetched models with case-insensitive normalization", () => {
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      modelOptions: ["Vendor/Existing"]
    });

    const next = addSettingsModelOptions(current, [
      "vendor/existing",
      "Vendor/New"
    ]);

    assert.equal(
      next.modelOptions.filter(
        (model) => model.toLowerCase() === "vendor/existing"
      ).length,
      1
    );
    assert.equal(next.modelOptions.includes("Vendor/New"), true);
  });

  it("selects a fallback when the active optional model is removed", () => {
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      model: "Vendor/Active",
      modelOptions: ["Vendor/Active", "Vendor/Other"]
    });

    const next = removeSettingsModelOption(current, "Vendor/Active");

    assert.notEqual(next.model, "Vendor/Active");
    assert.equal(next.modelOptions.includes("Vendor/Active"), false);
    assert.equal(next.modelOptions.includes(next.model), true);
  });

  it("exports normalized preferences without unrelated provider settings", () => {
    const exported = getExportedUserPreferences(
      normalizeApiSettings({
        ...DEFAULT_API_SETTINGS,
        userPreferencePrompt: "  concise  ",
        memoryItems: [
          { id: "memory-1", text: " First " },
          { id: "memory-1", text: "duplicate" },
          { id: "memory-2", text: "" }
        ]
      })
    );

    assert.deepEqual(exported, {
      userPreferencePrompt: "concise",
      memoryItems: [
        { id: "memory-1", text: "First" },
        { id: "memory-1-2", text: "duplicate" }
      ]
    });
  });

  it("imports only preferences and preserves the current provider", () => {
    const current = normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      providerId: "openai",
      model: "kept-model",
      apiKeySource: "manual",
      apiKey: "kept-key"
    });

    const next = applyImportedUserPreferences(current, {
      providerId: "custom",
      model: "ignored-model",
      apiKey: "ignored-key",
      userPreferencePrompt: "Imported prompt",
      memoryItems: [{ id: "imported", text: "Imported memory" }]
    });

    assert.equal(next.providerId, current.providerId);
    assert.equal(next.model, current.model);
    assert.equal(next.apiKey, current.apiKey);
    assert.equal(next.userPreferencePrompt, "Imported prompt");
    assert.deepEqual(next.memoryItems, [
      { id: "imported", text: "Imported memory" }
    ]);
  });
});
