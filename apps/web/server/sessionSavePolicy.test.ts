import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveClientSessionSave } from "./sessionSavePolicy.js";
import type {
  StoredMessage,
  StoredSessionState
} from "./sessionStateTypes.js";

function state(
  content: string,
  clientSaveRevisions?: Record<string, number>
): StoredSessionState {
  const messages: StoredMessage[] = [
    { id: "user-1", role: "user", content }
  ];
  return {
    sessions: [
      {
        id: "active",
        title: content,
        createdAt: 1,
        updatedAt: 1,
        messages,
        files: []
      }
    ],
    activeSessionId: "active",
    ...(clientSaveRevisions ? { clientSaveRevisions } : {})
  };
}

describe("revision-aware client session save policy", () => {
  it("ignores older and duplicate revisions without merging their state", () => {
    const current = state("newest", { "client-one": 12 });

    for (const saveRevision of [11, 12]) {
      const resolution = resolveClientSessionSave({
        current,
        incoming: state("stale"),
        deletedSessionIds: new Set(["active"]),
        clientId: "client-one",
        saveRevision
      });

      assert.equal(resolution.applied, false);
      assert.equal(resolution.currentSaveRevision, 12);
      assert.equal(resolution.state, current);
      assert.equal(resolution.state.sessions[0].messages[0].content, "newest");
      assert.deepEqual(resolution.state.deletedSessionIds, undefined);
    }
  });

  it("applies a newer revision and advances only that client watermark", () => {
    const resolution = resolveClientSessionSave({
      current: state("old", { "client-one": 12, "client-two": 30 }),
      incoming: state("new"),
      clientId: "client-one",
      saveRevision: 13
    });

    assert.equal(resolution.applied, true);
    assert.equal(resolution.state.sessions[0].messages[0].content, "new");
    assert.deepEqual(resolution.state.clientSaveRevisions, {
      "client-two": 30,
      "client-one": 13
    });
  });

  it("accepts legacy saves before migration but ignores them after a watermark", () => {
    const compatible = resolveClientSessionSave({
      current: state("old"),
      incoming: state("legacy"),
      clientId: "client-old",
      saveRevision: undefined
    });
    assert.equal(compatible.applied, true);
    assert.equal(compatible.state.sessions[0].messages[0].content, "legacy");

    const protectedState = state("modern", { "client-modern": 50 });
    const staleLegacy = resolveClientSessionSave({
      current: protectedState,
      incoming: state("legacy"),
      clientId: "client-old",
      saveRevision: undefined
    });
    assert.equal(staleLegacy.applied, false);
    assert.equal(staleLegacy.state, protectedState);
  });

  it("does not trust a client-supplied watermark map", () => {
    const incoming = state("new", { "client-one": 9999 });
    const resolution = resolveClientSessionSave({
      current: state("old", { "client-one": 8 }),
      incoming,
      clientId: "client-one",
      saveRevision: 9
    });

    assert.equal(resolution.applied, true);
    assert.deepEqual(resolution.state.clientSaveRevisions, {
      "client-one": 9
    });
  });
});
