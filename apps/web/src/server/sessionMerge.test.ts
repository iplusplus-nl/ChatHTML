import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeClientSaveState } from "../../server/sessions.js";

function session(id: string, updatedAt: number) {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messages: [],
    files: []
  };
}

describe("server session merge", () => {
  it("does not resurrect sessions deleted by another client", () => {
    const current = {
      sessions: [session("kept", 2)],
      activeSessionId: "kept",
      deletedSessionIds: ["deleted"]
    };
    const staleIncoming = {
      sessions: [session("deleted", 3), session("kept", 2)],
      activeSessionId: "deleted"
    };

    const merged = mergeClientSaveState(current, staleIncoming);

    assert.deepEqual(
      merged.sessions.map((item: { id: string }) => item.id),
      ["kept"]
    );
    assert.equal(merged.activeSessionId, "kept");
    assert.deepEqual(merged.deletedSessionIds, ["deleted"]);
  });

  it("records explicit deleted session ids as tombstones", () => {
    const current = {
      sessions: [session("deleted", 3), session("kept", 2)],
      activeSessionId: "deleted"
    };
    const incoming = {
      sessions: [session("kept", 2)],
      activeSessionId: "kept"
    };

    const merged = mergeClientSaveState(current, incoming, new Set(["deleted"]));

    assert.deepEqual(
      merged.sessions.map((item: { id: string }) => item.id),
      ["kept"]
    );
    assert.equal(merged.activeSessionId, "kept");
    assert.deepEqual(merged.deletedSessionIds, ["deleted"]);
  });

  it("allows a missing resumed run to be marked interrupted", () => {
    const current = {
      sessions: [
        {
          ...session("active", 2),
          messages: [
            {
              id: "a1",
              role: "assistant" as const,
              content: "",
              generationRunId: "run-1",
              streamSequence: 0,
              status: "streaming" as const
            }
          ]
        }
      ],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [
        {
          ...session("active", 3),
          messages: [
            {
              id: "a1",
              role: "assistant" as const,
              content: "I could not complete that request.",
              generationRunId: "run-1",
              streamSequence: 0,
              status: "error" as const,
              error: "The stream was interrupted before it completed."
            }
          ]
        }
      ],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);

    assert.equal(merged.sessions[0].messages[0].status, "error");
    assert.equal(
      merged.sessions[0].messages[0].error,
      "The stream was interrupted before it completed."
    );
  });
});
