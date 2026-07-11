import assert from "node:assert/strict";
import test from "node:test";
import type { ChatSession, SessionState } from "../../domain/chat/sessionModel";
import {
  deriveSessionListItems,
  getActiveSession
} from "./useSessionViewModel";

const session = (id: string, title = id): ChatSession => ({
  id,
  title,
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  files: []
});

test("resolves the requested active session and safely falls back", () => {
  const sessions = [session("first"), session("second")];
  const state: SessionState = { sessions, activeSessionId: "second" };
  assert.equal(getActiveSession(state), sessions[1]);
  assert.equal(
    getActiveSession({ ...state, activeSessionId: "missing" }),
    sessions[0]
  );
  assert.equal(getActiveSession({ sessions: [], activeSessionId: "missing" }), undefined);
});

test("derives sidebar titles without mutating sessions", () => {
  const titled = session("titled", "Custom");
  const untitled = {
    ...session("untitled", ""),
    messages: [
      {
        id: "user-a",
        role: "user" as const,
        content: "Derived title",
        status: "complete" as const
      }
    ]
  };
  assert.deepEqual(deriveSessionListItems([titled, untitled]), [
    { id: "titled", title: "Custom" },
    { id: "untitled", title: "Derived title" }
  ]);
});
