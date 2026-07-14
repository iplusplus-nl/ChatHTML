import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldDismissMessageEditor } from "./chatMessageEditModel";

describe("chat message edit model", () => {
  it("dismisses an open editor when generation removes edit capability", () => {
    assert.equal(shouldDismissMessageEditor(true, false), true);
    assert.equal(shouldDismissMessageEditor(true, true), false);
    assert.equal(shouldDismissMessageEditor(false, false), false);
  });
});
