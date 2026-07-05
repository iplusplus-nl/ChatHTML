import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isIgnoredRuntimeError } from "./ignoredRuntimeErrors";

describe("ignoredRuntimeErrors", () => {
  it("hides the legacy generic clipboard permission note", () => {
    assert.equal(
      isIgnoredRuntimeError({
        kind: "security",
        message: "Browser permission APIs are not allowed in ChatHTML artifacts."
      }),
      true
    );
  });

  it("keeps current specific permission notes visible", () => {
    assert.equal(
      isIgnoredRuntimeError({
        kind: "security",
        message:
          "Geolocation, camera, and microphone APIs are not allowed in ChatHTML artifacts."
      }),
      false
    );
  });
});
