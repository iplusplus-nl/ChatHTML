import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeClientSaveState } from "./sessionStateMerge.js";
import type {
  StoredMessage,
  StoredSession,
  StoredSessionState
} from "./sessionStateTypes.js";

function session(messages: StoredMessage[]): StoredSession {
  return {
    id: "active",
    title: "Active",
    createdAt: 1,
    updatedAt: 10,
    messages,
    files: []
  };
}

function state(messages: StoredMessage[]): StoredSessionState {
  return { sessions: [session(messages)], activeSessionId: "active" };
}

describe("session state merge module", () => {
  it("is idempotent after stale run, artifact, and draft policies settle", () => {
    const current = state([
      { id: "u1", role: "user", content: "Build a card" },
      {
        id: "a1",
        role: "assistant",
        content: "Partial",
        generationRunId: "run-2",
        streamSequence: 2,
        status: "streaming",
        artifactEditBaseRawStream: "<streamui>base</streamui>",
        activeArtifactEditId: "edit-1",
        artifactEdits: [
          {
            id: "edit-1",
            variants: [
              {
                id: "variant-1",
                status: "complete",
                rawStream: "<streamui>done</streamui>"
              }
            ]
          }
        ]
      }
    ]);
    current.clientSaveRevisions = { "client-current": 8 };
    current.sessions[0].files = [
      {
        id: "draft",
        kind: "image",
        name: "draft.png",
        mimeType: "image/png",
        size: 1,
        createdAt: 2,
        storageKey: "active/draft.png",
        draft: true
      }
    ];
    const incoming = state([
      { id: "u1", role: "user", content: "Build a card" },
      {
        id: "a1",
        role: "assistant",
        content: "Old terminal",
        generationRunId: "run-1",
        streamSequence: 99,
        generationOutcome: "complete",
        status: "complete"
      }
    ]);
    incoming.clientSaveRevisions = { "client-untrusted": 999 };
    incoming.sessions[0].updatedAt = 5;

    const once = mergeClientSaveState(current, incoming);
    const twice = mergeClientSaveState(once, once);

    assert.deepEqual(twice, once);
    assert.equal(once.sessions[0].messages[1].generationRunId, "run-2");
    assert.equal(once.sessions[0].messages[1].status, "streaming");
    assert.equal(once.sessions[0].messages[1].activeArtifactEditId, "edit-1");
    assert.equal(once.sessions[0].files?.[0].id, "draft");
    assert.deepEqual(once.clientSaveRevisions, { "client-current": 8 });
  });
});
