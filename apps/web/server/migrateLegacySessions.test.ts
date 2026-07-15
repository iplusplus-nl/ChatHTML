import assert from "node:assert/strict";
import test from "node:test";
import type { StoredSessionState } from "./sessionStateTypes.js";
import { rotateStateFileCapabilities } from "./migrateLegacySessions.js";

test("legacy migration rotates file capabilities without changing session content", () => {
  const source: StoredSessionState = {
    activeSessionId: "session-1",
    sessions: [
      {
        id: "session-1",
        title: "Private task",
        createdAt: 1,
        updatedAt: 2,
        messages: [{ id: "message-1", role: "user", content: "secret" }],
        files: [
          {
            id: "file-1",
            kind: "text",
            name: "private.txt",
            mimeType: "text/plain",
            size: 6,
            createdAt: 2,
            text: "secret",
            accessToken: "old-capability-token",
            embedUrl: "/api/files/file-1/content?token=old-capability-token",
            downloadUrl:
              "/api/files/file-1/content?token=old-capability-token&download=1"
          }
        ]
      }
    ]
  };

  const migrated = rotateStateFileCapabilities(source, () => "new-capability-token");

  assert.notEqual(migrated, source);
  assert.equal(migrated.sessions[0].messages[0].content, "secret");
  assert.equal(migrated.sessions[0].files?.[0].accessToken, "new-capability-token");
  assert.equal(migrated.sessions[0].files?.[0].embedUrl, undefined);
  assert.equal(migrated.sessions[0].files?.[0].downloadUrl, undefined);
  assert.equal(source.sessions[0].files?.[0].accessToken, "old-capability-token");
});
