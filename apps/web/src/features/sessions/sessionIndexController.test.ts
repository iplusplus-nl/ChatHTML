import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionState } from "../../domain/chat/sessionModel";
import {
  createSessionIndexController,
  type SessionIndexDependencies
} from "./sessionIndexController";
import type { SessionListPreview } from "./sessionPersistence";
import { runInitialSessionLoad } from "./sessionSyncController";

function preview(
  activeSessionId: string,
  title = activeSessionId
): SessionListPreview {
  return {
    activeSessionId,
    sessions: [{ id: activeSessionId, title }]
  };
}

function state(activeSessionId: string): SessionState {
  return {
    activeSessionId,
    sessions: [
      {
        id: activeSessionId,
        title: activeSessionId,
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        files: []
      }
    ]
  };
}

function responseFor(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function dependencies(
  overrides: Partial<SessionIndexDependencies>
): Partial<SessionIndexDependencies> {
  return {
    normalizePreview: (payload) => payload as SessionListPreview,
    previewFromState: (current) => preview(current.activeSessionId),
    saveCachedPreview: () => undefined,
    ...overrides
  };
}

describe("session index controller", () => {
  it("loads, normalizes, applies, and caches the startup index", async () => {
    const initial = preview("same", "Cached title");
    const normalized = preview("same", "Server title");
    const applied: Array<SessionListPreview | null> = [];
    const cached: Array<SessionListPreview | null> = [];
    let requestedClientId = "";
    let normalizedPayload: unknown;

    const controller = createSessionIndexController(
      {
        initialPreview: initial,
        isSessionsHydrated: () => false,
        setPreview: (value) => applied.push(value)
      },
      dependencies({
        requestIndex: async (clientId) => {
          requestedClientId = clientId;
          return responseFor({ source: "server" });
        },
        normalizePreview: (payload) => {
          normalizedPayload = payload;
          return normalized;
        },
        saveCachedPreview: (value) => cached.push(value)
      })
    );

    assert.equal(await controller.load("client-1", () => false), "applied");
    assert.equal(requestedClientId, "client-1");
    assert.deepEqual(normalizedPayload, { source: "server" });
    assert.deepEqual(applied, [normalized]);
    assert.deepEqual(cached, [normalized]);
    assert.equal(controller.getLastPayload(), JSON.stringify(normalized));
  });

  it("surfaces HTTP failures without parsing or applying the response", async () => {
    let normalized = false;
    let applied = false;

    const controller = createSessionIndexController(
      {
        initialPreview: null,
        isSessionsHydrated: () => false,
        setPreview: () => {
          applied = true;
        }
      },
      dependencies({
        requestIndex: async () => responseFor({}, 503),
        normalizePreview: () => {
          normalized = true;
          return null;
        }
      })
    );

    await assert.rejects(
      controller.load("client-1", () => false),
      /Session index load failed with HTTP 503\./
    );
    assert.equal(normalized, false);
    assert.equal(applied, false);
  });

  it("suppresses a cancelled response before normalize, state, and cache writes", async () => {
    let normalized = false;
    let applied = false;
    let cached = false;

    const controller = createSessionIndexController(
      {
        initialPreview: null,
        isSessionsHydrated: () => false,
        setPreview: () => {
          applied = true;
        }
      },
      dependencies({
        requestIndex: async () => responseFor({ sessions: [] }),
        normalizePreview: () => {
          normalized = true;
          return null;
        },
        saveCachedPreview: () => {
          cached = true;
        }
      })
    );

    assert.equal(await controller.load("client-1", () => true), "cancelled");
    assert.equal(normalized, false);
    assert.equal(applied, false);
    assert.equal(cached, false);
  });

  it("ignores a slow index response after full sessions become authoritative", async () => {
    const pending = deferred<Response>();
    let sessionsHydrated = false;
    let normalized = false;
    let applied = false;
    let cached = false;

    const controller = createSessionIndexController(
      {
        initialPreview: preview("cached"),
        isSessionsHydrated: () => sessionsHydrated,
        setPreview: () => {
          applied = true;
        }
      },
      dependencies({
        requestIndex: async () => pending.promise,
        normalizePreview: () => {
          normalized = true;
          return preview("stale-index");
        },
        saveCachedPreview: () => {
          cached = true;
        }
      })
    );

    const loading = controller.load("client-1", () => false);
    sessionsHydrated = true;
    pending.resolve(responseFor(preview("stale-index")));

    assert.equal(await loading, "skipped");
    assert.equal(normalized, false);
    assert.equal(applied, false);
    assert.equal(cached, false);
  });

  it("still applies a slow index after the full hydration attempt fails", async () => {
    const pendingIndex = deferred<Response>();
    const pendingFullState = deferred<Response>();
    let sessionsHydrated = false;
    const applied: Array<SessionListPreview | null> = [];
    const cached: Array<SessionListPreview | null> = [];
    const expected = preview("index-after-full-error");

    const controller = createSessionIndexController(
      {
        initialPreview: preview("cached"),
        isSessionsHydrated: () => sessionsHydrated,
        setPreview: (value) => applied.push(value)
      },
      dependencies({
        requestIndex: async () => pendingIndex.promise,
        saveCachedPreview: (value) => cached.push(value)
      })
    );

    const loadingIndex = controller.load("client-1", () => false);
    const loadingFullState = runInitialSessionLoad(
      {
        clientId: "client-1",
        isCancelled: () => false,
        updateState: () => undefined,
        onApplied: () => {
          sessionsHydrated = true;
        },
        getDeletedSessionIds: () => [],
        getTransientEmptySessionId: () => null
      },
      { requestSessions: async () => pendingFullState.promise }
    );

    pendingFullState.resolve(responseFor({}, 503));
    await assert.rejects(
      loadingFullState,
      /Session load failed with HTTP 503\./
    );
    assert.equal(sessionsHydrated, false);

    pendingIndex.resolve(responseFor(expected));

    assert.equal(await loadingIndex, "applied");
    assert.deepEqual(applied, [expected]);
    assert.deepEqual(cached, [expected]);
  });

  it("does not derive a preview before full session hydration", () => {
    let derived = false;
    let applied = false;
    const controller = createSessionIndexController(
      {
        initialPreview: null,
        isSessionsHydrated: () => false,
        setPreview: () => {
          applied = true;
        }
      },
      dependencies({
        previewFromState: () => {
          derived = true;
          return preview("unused");
        }
      })
    );

    assert.equal(controller.syncFromState(state("draft"), false), "skipped");
    assert.equal(derived, false);
    assert.equal(applied, false);
  });

  it("deduplicates unchanged hydrated previews and applies later changes", () => {
    const applied: Array<SessionListPreview | null> = [];
    const cached: Array<SessionListPreview | null> = [];
    const controller = createSessionIndexController(
      {
        initialPreview: preview("first"),
        isSessionsHydrated: () => true,
        setPreview: (value) => applied.push(value)
      },
      dependencies({
        saveCachedPreview: (value) => cached.push(value)
      })
    );

    assert.equal(controller.syncFromState(state("first"), true), "skipped");
    assert.equal(controller.syncFromState(state("second"), true), "applied");
    assert.equal(controller.syncFromState(state("second"), true), "skipped");
    assert.deepEqual(applied, [preview("second")]);
    assert.deepEqual(cached, [preview("second")]);
  });

  it("clears a previously populated preview when hydrated sessions become empty", () => {
    const applied: Array<SessionListPreview | null> = [];
    const cached: Array<SessionListPreview | null> = [];
    const emptyState: SessionState = { activeSessionId: "", sessions: [] };
    const controller = createSessionIndexController(
      {
        initialPreview: preview("cached"),
        isSessionsHydrated: () => true,
        setPreview: (value) => applied.push(value)
      },
      dependencies({
        previewFromState: () => null,
        saveCachedPreview: (value) => cached.push(value)
      })
    );

    assert.equal(controller.syncFromState(emptyState, true), "applied");
    assert.deepEqual(applied, [null]);
    assert.deepEqual(cached, [null]);
    assert.equal(controller.getLastPayload(), null);
  });
});
