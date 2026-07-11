import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeClientSaveRevisions,
  normalizeSessionSaveClientId,
  normalizeSessionSaveRevision,
  recordSessionSaveRevision,
  shouldApplySessionSaveRevision
} from "./sessionSaveRevision.js";
import type { StoredSessionState } from "./sessionStateTypes.js";

function state(
  clientSaveRevisions?: Record<string, number>
): StoredSessionState {
  return {
    sessions: [],
    activeSessionId: "empty",
    ...(clientSaveRevisions ? { clientSaveRevisions } : {})
  };
}

describe("session save revision model", () => {
  it("normalizes client ids, revisions, and persisted watermarks", () => {
    assert.equal(normalizeSessionSaveClientId(" client-good! "), "client-good");
    assert.equal(normalizeSessionSaveClientId("short"), "");
    assert.equal(normalizeSessionSaveRevision(12), 12);
    assert.equal(normalizeSessionSaveRevision(0), undefined);
    assert.equal(normalizeSessionSaveRevision(1.5), undefined);
    assert.deepEqual(
      normalizeClientSaveRevisions({
        "client-one": 10,
        short: 20,
        "client-two": -1,
        "client-three": 30
      }),
      { "client-one": 10, "client-three": 30 }
    );
  });

  it("accepts only revisions above the saved watermark", () => {
    const current = state({ "client-one": 10 });

    assert.equal(shouldApplySessionSaveRevision(current, "client-one", 9), false);
    assert.equal(shouldApplySessionSaveRevision(current, "client-one", 10), false);
    assert.equal(shouldApplySessionSaveRevision(current, "client-one", 11), true);
    assert.equal(shouldApplySessionSaveRevision(current, "client-two", 1), true);
  });

  it("keeps legacy saves compatible only until a revision watermark exists", () => {
    assert.equal(shouldApplySessionSaveRevision(state(), "client-old", undefined), true);
    assert.equal(
      shouldApplySessionSaveRevision(
        state({ "client-modern": 10 }),
        "client-old",
        undefined
      ),
      false
    );
    assert.equal(
      shouldApplySessionSaveRevision(
        state({ "client-modern": 10 }),
        "",
        undefined
      ),
      false
    );
  });

  it("records the accepted client at the newest end of the bounded map", () => {
    const current = state({ "client-one": 1, "client-two": 2 });
    const recorded = recordSessionSaveRevision(current, "client-one", 3);

    assert.deepEqual(recorded.clientSaveRevisions, {
      "client-two": 2,
      "client-one": 3
    });
    assert.deepEqual(current.clientSaveRevisions, {
      "client-one": 1,
      "client-two": 2
    });
  });
});
