import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionState } from "../../domain/chat/sessionModel";
import {
  clearLegacyLocalSessions,
  loadCachedSessionListPreview,
  loadLegacyLocalSessionState,
  loadSessionClientId,
  normalizeSessionListPreview,
  saveCachedSessionListPreview,
  serializeSessionStateForSave,
  sessionListPreviewFromState,
  type SessionStorage
} from "./sessionPersistence";

function memoryStorage(initial: Record<string, string> = {}): SessionStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

function state(): SessionState {
  return {
    activeSessionId: "saved",
    sessions: [
      {
        id: "empty",
        title: "New Session",
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        files: []
      },
      {
        id: "saved",
        title: "Saved",
        createdAt: 2,
        updatedAt: 2,
        messages: [{ id: "user-1", role: "user", content: "Hello" }],
        files: []
      }
    ]
  };
}

describe("session persistence", () => {
  it("normalizes sidebar previews and repairs the active session", () => {
    assert.deepEqual(
      normalizeSessionListPreview({
        activeSessionId: "missing",
        sessions: [
          { id: " one ", title: " First " },
          { id: "one", title: "Duplicate" },
          { id: "two", title: "" },
          { id: "", title: "Invalid" }
        ]
      }),
      {
        activeSessionId: "one",
        sessions: [
          { id: "one", title: "First" },
          { id: "two", title: "New Session" }
        ]
      }
    );
    assert.equal(normalizeSessionListPreview({ sessions: [] }), null);
  });

  it("builds previews and serialized state without empty transient sessions", () => {
    assert.deepEqual(sessionListPreviewFromState(state()), {
      activeSessionId: "saved",
      sessions: [{ id: "saved", title: "Saved" }]
    });

    const serialized = JSON.parse(
      serializeSessionStateForSave(state(), "client-1", ["deleted"])
    );
    assert.equal(serialized.clientId, "client-1");
    assert.deepEqual(serialized.deletedSessionIds, ["deleted"]);
    assert.deepEqual(
      serialized.sessions.map((session: { id: string }) => session.id),
      ["saved"]
    );
  });

  it("loads and saves the sidebar cache", () => {
    const storage = memoryStorage();
    const preview = {
      activeSessionId: "session-1",
      sessions: [{ id: "session-1", title: "Demo" }]
    };

    saveCachedSessionListPreview(preview, storage);
    assert.deepEqual(loadCachedSessionListPreview(storage), preview);
    saveCachedSessionListPreview(null, storage);
    assert.equal(loadCachedSessionListPreview(storage), null);
  });

  it("reuses or creates a stable client id", () => {
    const existing = memoryStorage({ "streamui.clientId.v1": "client-existing" });
    assert.equal(
      loadSessionClientId(existing, () => "client-new"),
      "client-existing"
    );

    const empty = memoryStorage();
    assert.equal(loadSessionClientId(empty, () => "client-new"), "client-new");
    assert.equal(loadSessionClientId(empty, () => "client-other"), "client-new");
  });

  it("migrates and clears legacy local sessions", () => {
    const storage = memoryStorage({
      "streamui.sessions.v1": JSON.stringify([
        {
          id: "session-1",
          title: "Legacy",
          createdAt: 1,
          updatedAt: 1,
          messages: [{ id: "user-1", role: "user", content: "Hello" }]
        }
      ]),
      "streamui.activeSession.v1": "session-1"
    });

    const migrated = loadLegacyLocalSessionState(storage);
    assert.equal(migrated?.activeSessionId, "session-1");
    assert.equal(migrated?.sessions[0].title, "Hello");

    clearLegacyLocalSessions(storage);
    assert.equal(loadLegacyLocalSessionState(storage), null);
  });
});
