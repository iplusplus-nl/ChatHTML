import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactEmptyStoredSessions,
  hasDraftSessionFiles,
  isStoredSessionEmpty,
  normalizeStoredSessionState,
  selectPresentSessionMessagePatch
} from "./sessionStateModel.js";
import type { StoredSession } from "./sessionStateTypes.js";

function session(
  id: string,
  updatedAt: number,
  messages: StoredSession["messages"] = []
): StoredSession {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt,
    messages,
    files: []
  };
}

describe("server session state model", () => {
  it("normalizes tombstones, ordering, and the active session together", () => {
    const normalized = normalizeStoredSessionState({
      sessions: [
        session("deleted", 30),
        session("older", 10, [{ id: "u1", role: "user", content: "old" }]),
        session("newer", 20, [{ id: "u2", role: "user", content: "new" }])
      ],
      activeSessionId: "deleted",
      deletedSessionIds: ["deleted", "deleted"],
      clientSaveRevisions: {
        "client-valid": 41,
        short: 42,
        "client-invalid": -1
      }
    });

    assert.deepEqual(
      normalized.sessions.map((candidate) => candidate.id),
      ["newer", "older"]
    );
    assert.equal(normalized.activeSessionId, "newer");
    assert.deepEqual(normalized.deletedSessionIds, ["deleted"]);
    assert.deepEqual(normalized.clientSaveRevisions, {
      "client-valid": 41
    });
  });

  it("preserves revision watermarks while repairing an empty stored state", () => {
    const normalized = normalizeStoredSessionState({
      sessions: [],
      activeSessionId: "missing",
      clientSaveRevisions: { "client-reload": 77 }
    });

    assert.equal(normalized.sessions.length, 1);
    assert.deepEqual(normalized.clientSaveRevisions, {
      "client-reload": 77
    });
  });

  it("compacts a cancelled branch during normalization and stays idempotent", () => {
    const input = {
      sessions: [
        {
          ...session("active", 10),
          branchSelections: { group: "cancelled" },
          messages: [
            {
              id: "original",
              role: "assistant" as const,
              content: "Original",
              branchGroupId: "group",
              branchVariantId: "original"
            },
            {
              id: "cancelled-user",
              role: "user" as const,
              content: "Retry",
              branchGroupId: "group",
              branchVariantId: "cancelled"
            },
            {
              id: "cancelled-assistant",
              role: "assistant" as const,
              content: "partial",
              branchGroupId: "group",
              branchVariantId: "cancelled",
              generationRunId: "run-2",
              generationOutcome: "cancelled" as const,
              status: "complete" as const,
              branchRunRollback: {
                runId: "run-2",
                groupId: "group",
                variantId: "cancelled",
                fallbackVariantId: "original"
              }
            }
          ]
        }
      ],
      activeSessionId: "active"
    };

    const once = normalizeStoredSessionState(input);
    const twice = normalizeStoredSessionState(once);

    assert.deepEqual(twice, once);
    assert.deepEqual(
      once.sessions[0].messages.map((message) => message.id),
      ["original", "cancelled-assistant"]
    );
    assert.equal(once.sessions[0].messages[1].content, "");
    assert.equal(once.sessions[0].branchSelections?.group, "original");
  });

  it("distinguishes hidden draft files from committed visible content", () => {
    const draftOnly: StoredSession = {
      ...session("draft", 2),
      files: [
        {
          id: "draft-file",
          kind: "image",
          name: "draft.png",
          mimeType: "image/png",
          size: 1,
          createdAt: 2,
          storageKey: "draft/file.png",
          draft: true
        }
      ]
    };
    const visible = session("visible", 1, [
      { id: "u1", role: "user", content: "hello" }
    ]);

    assert.equal(hasDraftSessionFiles(draftOnly), true);
    assert.equal(isStoredSessionEmpty(draftOnly), true);
    assert.deepEqual(
      compactEmptyStoredSessions([draftOnly, visible], "draft"),
      { sessions: [visible], activeSessionId: "visible" }
    );
  });

  it("builds patches only from explicitly present message fields", () => {
    const normalized = {
      id: "a1",
      role: "assistant" as const,
      content: "",
      rawStream: undefined,
      status: "complete" as const,
      error: undefined
    };

    assert.deepEqual(
      selectPresentSessionMessagePatch(
        { id: "a1", role: "assistant", content: "", error: undefined },
        normalized
      ),
      { content: "", error: undefined }
    );
  });
});
