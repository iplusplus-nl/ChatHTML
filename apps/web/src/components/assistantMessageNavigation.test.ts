import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAssistantMessageNavigationKinds } from "./assistantMessageNavigation";

describe("assistant message navigation", () => {
  it("keeps artifact-version and response-branch navigation together", () => {
    assert.deepEqual(getAssistantMessageNavigationKinds(true, true), [
      "artifact-versions",
      "response-branches"
    ]);
  });

  it("omits only navigation groups that are unavailable", () => {
    assert.deepEqual(getAssistantMessageNavigationKinds(true, false), [
      "artifact-versions"
    ]);
    assert.deepEqual(getAssistantMessageNavigationKinds(false, true), [
      "response-branches"
    ]);
  });
});
