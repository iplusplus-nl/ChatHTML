import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  POP_ART_STYLE_PREFERENCE,
  addPopArtStylePreference,
  completePopArtOnboarding,
  hasCompletedPopArtOnboarding
} from "./popArtOnboarding";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value)
  };
}

describe("Pop Art onboarding", () => {
  it("remembers completion independently for each signed-in user", () => {
    const storage = memoryStorage();

    assert.equal(hasCompletedPopArtOnboarding("user-a", storage), false);
    completePopArtOnboarding("user-a", storage);

    assert.equal(hasCompletedPopArtOnboarding("user-a", storage), true);
    assert.equal(hasCompletedPopArtOnboarding("user-b", storage), false);
  });

  it("adds the editable Pop Art instruction without duplicating it", () => {
    assert.equal(addPopArtStylePreference(""), POP_ART_STYLE_PREFERENCE);
    assert.equal(
      addPopArtStylePreference("- Prefer concise answers.  "),
      `- Prefer concise answers.\n${POP_ART_STYLE_PREFERENCE}`
    );
    assert.equal(
      addPopArtStylePreference(`- Warm tone\n${POP_ART_STYLE_PREFERENCE}`),
      `- Warm tone\n${POP_ART_STYLE_PREFERENCE}`
    );
  });
});
