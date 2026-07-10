import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClientMessage } from "../../domain/chat/sessionModel";
import {
  reconcileChatRunState,
  type ChatRunReconcileState
} from "./chatRunReconcile";

function state(
  overrides: Partial<ChatRunReconcileState> = {}
): ChatRunReconcileState {
  return {
    runId: "run-1",
    raw: "abc",
    reasoning: "thinking",
    streamSequence: 3,
    doneError: "",
    completedFromServer: false,
    ...overrides
  };
}

function assistant(
  overrides: Partial<ClientMessage> = {}
): ClientMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    status: "streaming",
    generationRunId: "run-1",
    rawStream: "abc",
    reasoning: "thinking",
    streamSequence: 3,
    ...overrides
  };
}

describe("chat run server reconciliation", () => {
  it("rejects non-assistant, foreign-run, and stale messages", () => {
    const current = state();
    const user: ClientMessage = { id: "user-1", role: "user", content: "hello" };

    assert.deepEqual(reconcileChatRunState(current, user), {
      accepted: false,
      state: current,
      abortConnection: false
    });
    assert.equal(
      reconcileChatRunState(
        current,
        assistant({ generationRunId: "run-2", streamSequence: 9 })
      ).accepted,
      false
    );
    assert.equal(reconcileChatRunState(current, assistant()).accepted, false);
  });

  it("accepts a newer sequence without mutating the input", () => {
    const current = state();
    const result = reconcileChatRunState(
      current,
      assistant({
        rawStream: "abcdef",
        reasoning: "thinking more",
        streamSequence: 4
      })
    );

    assert.equal(result.accepted, true);
    assert.equal(result.phase, "streaming");
    assert.equal(result.abortConnection, false);
    assert.deepEqual(result.state, {
      ...current,
      raw: "abcdef",
      reasoning: "thinking more",
      streamSequence: 4
    });
    assert.deepEqual(current, state());
  });

  it("accepts longer raw or reasoning even at the same sequence", () => {
    assert.equal(
      reconcileChatRunState(state(), assistant({ rawStream: "abcdef" })).accepted,
      true
    );
    assert.equal(
      reconcileChatRunState(
        state(),
        assistant({ reasoning: "thinking with more detail" })
      ).accepted,
      true
    );
  });

  it("accepts a same-sequence terminal update and requests abort", () => {
    const result = reconcileChatRunState(
      state(),
      assistant({
        status: "error",
        error: '{"error":{"message":"Provider failed"}}'
      })
    );

    assert.equal(result.accepted, true);
    assert.equal(result.phase, "error");
    assert.equal(result.abortConnection, true);
    assert.deepEqual(result.state, {
      ...state(),
      doneStatus: "error",
      doneError: "Provider failed",
      completedFromServer: true
    });
  });

  it("allows legacy server messages without a run id", () => {
    const result = reconcileChatRunState(
      state(),
      assistant({ generationRunId: undefined, streamSequence: 4 })
    );

    assert.equal(result.accepted, true);
    assert.equal(result.state.streamSequence, 4);
  });
});
