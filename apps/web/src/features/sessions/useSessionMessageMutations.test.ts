import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChatSession,
  ClientMessage,
  SessionState
} from "../../domain/chat/sessionModel";
import {
  appendRuntimeErrorInState,
  mutateArtifactEditMessageInState
} from "./useSessionMessageMutations";

const assistant = (id: string): ClientMessage => ({
  id,
  role: "assistant",
  content: "before",
  status: "complete"
});

const session = (id: string, messages: ClientMessage[]): ChatSession => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  messages,
  files: []
});

test("mutates only the exact artifact edit target", () => {
  const state: SessionState = {
    activeSessionId: "session-a",
    sessions: [
      session("session-a", [assistant("shared")]),
      session("session-b", [assistant("shared")])
    ]
  };

  const mutation = mutateArtifactEditMessageInState(
    state,
    { sessionId: "session-b", assistantId: "shared" },
    (message) => ({ ...message, content: "after" })
  );

  assert.equal(mutation.outcome, "applied");
  assert.equal(
    mutation.state.sessions.find((candidate) => candidate.id === "session-a")
      ?.messages[0].content,
    "before"
  );
  assert.equal(
    mutation.state.sessions.find((candidate) => candidate.id === "session-b")
      ?.messages[0].content,
    "after"
  );
});

test("distinguishes missing, unchanged, and applied mutations", () => {
  const state: SessionState = {
    activeSessionId: "session-a",
    sessions: [session("session-a", [assistant("assistant-a")])]
  };

  const missing = mutateArtifactEditMessageInState(
    state,
    { sessionId: "session-a", assistantId: "missing" },
    (message) => ({ ...message, content: "after" })
  );
  assert.equal(missing.outcome, "missing");
  assert.equal(missing.state, state);

  const unchanged = mutateArtifactEditMessageInState(
    state,
    { sessionId: "session-a", assistantId: "assistant-a" },
    (message) => message
  );
  assert.equal(unchanged.outcome, "unchanged");
  assert.equal(unchanged.state, state);

  const applied = mutateArtifactEditMessageInState(
    state,
    { sessionId: "session-a", assistantId: "assistant-a" },
    (message) => ({ ...message, content: "after" })
  );
  assert.equal(applied.outcome, "applied");
  assert.notEqual(applied.state, state);
});

test("appends runtime errors once without touching messages without snapshots", () => {
  const error = { kind: "runtime" as const, message: "boom", timestamp: 5 };
  const target = {
    ...assistant("assistant-a"),
    snapshot: {
      raw: "raw",
      completedHtml: "<p>test</p>",
      iframeDocument: "<html></html>",
      errors: [],
      status: "complete" as const
    }
  };
  const state: SessionState = {
    activeSessionId: "session-a",
    sessions: [session("session-a", [target, assistant("without-snapshot")])]
  };

  const updated = appendRuntimeErrorInState(state, "assistant-a", error);
  const updatedMessage = updated.sessions[0].messages[0];
  assert.deepEqual(updatedMessage.runtimeErrors, [error]);
  assert.deepEqual(updatedMessage.snapshot?.errors, [error]);
  assert.equal(
    appendRuntimeErrorInState(updated, "assistant-a", error),
    updated
  );
  assert.equal(
    appendRuntimeErrorInState(state, "without-snapshot", error),
    state
  );
});

test("replaces and clears the stateful readability finding", () => {
  const runtimeError = {
    kind: "runtime" as const,
    message: "boom",
    timestamp: 1
  };
  const firstReadability = {
    kind: "readability" as const,
    message: "First contrast report",
    timestamp: 2
  };
  const target = {
    ...assistant("assistant-a"),
    runtimeErrors: [runtimeError, firstReadability],
    snapshot: {
      raw: "raw",
      completedHtml: "<p>test</p>",
      iframeDocument: "<html></html>",
      errors: [runtimeError, firstReadability],
      status: "complete" as const
    }
  };
  const state: SessionState = {
    activeSessionId: "session-a",
    sessions: [session("session-a", [target])]
  };
  const nextReadability = {
    kind: "readability" as const,
    message: "Updated contrast report",
    timestamp: 3
  };

  const replaced = appendRuntimeErrorInState(
    state,
    "assistant-a",
    nextReadability
  );
  const replacedMessage = replaced.sessions[0].messages[0];
  assert.deepEqual(replacedMessage.runtimeErrors, [runtimeError, nextReadability]);
  assert.deepEqual(replacedMessage.snapshot?.errors, [runtimeError, nextReadability]);

  const cleared = appendRuntimeErrorInState(replaced, "assistant-a", {
    kind: "readability",
    message: "",
    timestamp: 4
  });
  const clearedMessage = cleared.sessions[0].messages[0];
  assert.deepEqual(clearedMessage.runtimeErrors, [runtimeError]);
  assert.deepEqual(clearedMessage.snapshot?.errors, [runtimeError]);
  assert.equal(
    appendRuntimeErrorInState(cleared, "assistant-a", {
      kind: "readability",
      message: "",
      timestamp: 5
    }),
    cleared
  );
});
