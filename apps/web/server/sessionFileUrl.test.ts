import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSessionFileContentUrl } from "./sessions.js";

describe("session file presentation urls", () => {
  it("keeps tokenized embeds on the browser application origin", () => {
    assert.equal(
      buildSessionFileContentUrl("", "file/one", "token two"),
      "/api/files/file%2Fone/content?token=token%20two"
    );
    assert.equal(
      buildSessionFileContentUrl("/chat", "file", "token", true),
      "/chat/api/files/file/content?token=token&download=1"
    );
  });
});
