import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDeferredSessionSelectionController } from "./deferredSessionSelection";

describe("deferred session selection", () => {
  it("replays a cached preview click after full hydration", () => {
    const sessions = new Set<string>();
    const selected: string[] = [];
    const controller = createDeferredSessionSelectionController({
      hasSession: (sessionId) => sessions.has(sessionId),
      selectSession: (sessionId) => {
        if (!sessions.has(sessionId)) {
          return "not-found";
        }
        selected.push(sessionId);
        return "selected";
      }
    });

    assert.equal(controller.request("cached-session", false), "deferred");
    assert.equal(controller.peek(), "cached-session");
    assert.deepEqual(selected, []);

    sessions.add("cached-session");
    assert.equal(controller.flush(true), "selected");
    assert.deepEqual(selected, ["cached-session"]);
    assert.equal(controller.peek(), null);
    assert.equal(controller.flush(true), "empty");
  });

  it("keeps only the latest preview intent and clears a missing hydrated target", () => {
    const selected: string[] = [];
    const controller = createDeferredSessionSelectionController({
      hasSession: () => false,
      selectSession: (sessionId) => {
        selected.push(sessionId);
        return "not-found";
      }
    });

    assert.equal(controller.request("first", false), "deferred");
    assert.equal(controller.request("second", false), "deferred");
    assert.equal(controller.flush(false), "blocked");
    assert.equal(controller.peek(), "second");
    assert.equal(controller.flush(true), "not-found");
    assert.deepEqual(selected, ["second"]);
    assert.equal(controller.peek(), null);
  });

  it("selects already available sessions immediately before hydration", () => {
    const selected: string[] = [];
    const controller = createDeferredSessionSelectionController({
      hasSession: (sessionId) => sessionId === "draft",
      selectSession: (sessionId) => {
        selected.push(sessionId);
        return "selected";
      }
    });

    assert.equal(controller.request("draft", false), "selected");
    assert.deepEqual(selected, ["draft"]);
    assert.equal(controller.peek(), null);
  });
});
