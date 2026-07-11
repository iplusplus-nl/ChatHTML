import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptySession,
  type ClientMessage,
  type SessionState
} from "../../domain/chat/sessionModel";
import { createArtifactActionController } from "./artifactActionController";

function assistant(id: string): ClientMessage {
  return {
    id,
    role: "assistant",
    content: "artifact",
    status: "complete"
  };
}

function createState(): SessionState {
  const first = {
    ...createEmptySession(1, "session-1"),
    messages: [assistant("assistant-1")]
  };
  const second = {
    ...createEmptySession(2, "session-2"),
    messages: [assistant("assistant-2")]
  };
  return {
    activeSessionId: second.id,
    sessions: [first, second]
  };
}

describe("artifact action controller", () => {
  it("sends valid prompt actions to the message-owning session", () => {
    const sent: Array<{ text: string; sessionId: string }> = [];
    let state = createState();
    const controller = createArtifactActionController({
      isSending: () => false,
      getSessionState: () => state,
      sendActionMessage: (text, sessionId) => sent.push({ text, sessionId })
    });

    assert.equal(
      controller.handleAction("assistant-1", {
        type: "prompt",
        prompt: "  update the chart  "
      }),
      "sent"
    );
    assert.deepEqual(sent, [
      { text: "update the chart", sessionId: "session-1" }
    ]);
  });

  it("ignores non-prompt actions and actions without an owning message", () => {
    const sent: Array<{ text: string; sessionId: string }> = [];
    const state = createState();
    const controller = createArtifactActionController({
      isSending: () => false,
      getSessionState: () => state,
      sendActionMessage: (text, sessionId) => sent.push({ text, sessionId })
    });

    assert.equal(
      controller.handleAction("assistant-1", { type: "copy", text: "copy" }),
      "ignored"
    );
    assert.equal(
      controller.handleAction("missing", {
        type: "prompt",
        prompt: "fallback"
      }),
      "ignored"
    );
    assert.deepEqual(sent, []);
  });

  it("keeps only the latest busy action and flushes it exactly once", () => {
    let sending = true;
    let state = createState();
    const sent: Array<{ text: string; sessionId: string }> = [];
    const controller = createArtifactActionController({
      isSending: () => sending,
      getSessionState: () => state,
      sendActionMessage: (text, sessionId) => sent.push({ text, sessionId })
    });

    assert.equal(
      controller.handleAction("assistant-1", {
        type: "prompt",
        prompt: "first"
      }),
      "queued"
    );
    assert.equal(
      controller.handleAction("assistant-2", {
        type: "prompt",
        prompt: "second"
      }),
      "queued"
    );
    assert.equal(controller.flushPendingAction(), "blocked");
    assert.deepEqual(sent, []);

    state = { ...state, activeSessionId: "session-1" };
    sending = false;
    assert.equal(controller.flushPendingAction(), "sent");
    assert.equal(controller.flushPendingAction(), "empty");
    assert.deepEqual(sent, [{ text: "second", sessionId: "session-2" }]);
  });

  it("does not let an invalid busy action replace a valid queued action", () => {
    let sending = true;
    const state = createState();
    const sent: string[] = [];
    const controller = createArtifactActionController({
      isSending: () => sending,
      getSessionState: () => state,
      sendActionMessage: (text) => sent.push(text)
    });

    assert.equal(
      controller.handleAction("assistant-1", {
        type: "prompt",
        prompt: "keep me"
      }),
      "queued"
    );
    assert.equal(
      controller.handleAction("assistant-1", { type: "copy", text: "copy" }),
      "ignored"
    );
    sending = false;
    assert.equal(controller.flushPendingAction(), "sent");
    assert.deepEqual(sent, ["keep me"]);
  });

  it("drops a queued action when its locked session disappears", () => {
    let sending = true;
    let state = createState();
    const sent: string[] = [];
    const controller = createArtifactActionController({
      isSending: () => sending,
      getSessionState: () => state,
      sendActionMessage: (text) => sent.push(text)
    });

    assert.equal(
      controller.handleAction("assistant-1", {
        type: "prompt",
        prompt: "do not redirect"
      }),
      "queued"
    );
    state = {
      ...state,
      sessions: state.sessions.filter((session) => session.id !== "session-1")
    };
    sending = false;
    assert.equal(controller.flushPendingAction(), "ignored");
    assert.equal(controller.flushPendingAction(), "empty");
    assert.deepEqual(sent, []);
  });

  it("drops a queued action when its source message disappears", () => {
    let sending = true;
    let state = createState();
    const sent: string[] = [];
    const controller = createArtifactActionController({
      isSending: () => sending,
      getSessionState: () => state,
      sendActionMessage: (text) => sent.push(text)
    });

    assert.equal(
      controller.handleAction("assistant-1", {
        type: "prompt",
        prompt: "do not redirect"
      }),
      "queued"
    );
    state = {
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === "session-1" ? { ...session, messages: [] } : session
      )
    };
    sending = false;
    assert.equal(controller.flushPendingAction(), "ignored");
    assert.deepEqual(sent, []);
  });
});
