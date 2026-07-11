import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionFile, SessionState } from "../../domain/chat/sessionModel";
import {
  findSessionIdForMessage,
  findSessionMessage,
  mergeSessionFiles
} from "./sessionSelectors";

const state: SessionState = {
  activeSessionId: "session-1",
  sessions: [
    {
      id: "session-1",
      title: "One",
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: "message-1", role: "user", content: "Hello" }],
      files: []
    },
    {
      id: "session-2",
      title: "Two",
      createdAt: 2,
      updatedAt: 2,
      messages: [{ id: "message-2", role: "assistant", content: "Hi" }],
      files: []
    }
  ]
};

describe("session selectors", () => {
  it("finds messages and their owning sessions", () => {
    assert.equal(findSessionMessage(state, "message-2")?.content, "Hi");
    assert.equal(findSessionIdForMessage(state, "message-2"), "session-2");
    assert.equal(findSessionMessage(state, "missing"), undefined);
    assert.equal(findSessionIdForMessage(state, "missing"), undefined);
  });

  it("deduplicates files by id using the latest value and sorts by creation", () => {
    const files: SessionFile[] = [
      {
        id: "file-2",
        kind: "artifact",
        name: "old.html",
        mimeType: "text/html",
        size: 2,
        createdAt: 2
      },
      {
        id: "file-1",
        kind: "image",
        name: "image.png",
        mimeType: "image/png",
        size: 1,
        createdAt: 1
      },
      {
        id: "file-2",
        kind: "artifact",
        name: "new.html",
        mimeType: "text/html",
        size: 3,
        createdAt: 2
      }
    ];

    assert.deepEqual(
      mergeSessionFiles(files).map((file) => [file.id, file.name]),
      [
        ["file-1", "image.png"],
        ["file-2", "new.html"]
      ]
    );
  });
});
