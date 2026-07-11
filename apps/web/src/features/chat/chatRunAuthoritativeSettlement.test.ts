import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClientMessage, SessionState } from "../../domain/chat/sessionModel";
import {
  settleAuthoritativeChatRun,
  type ChatRunAuthoritativeSettlementPorts
} from "./chatRunAuthoritativeSettlement";
import type { ChatRunExecutionController } from "./chatRunExecutionController";

const target = {
  runId: "run-1",
  sessionId: "session-1",
  assistantId: "assistant-1"
};

function assistant(overrides: Partial<ClientMessage> = {}): ClientMessage {
  return {
    id: target.assistantId,
    role: "assistant",
    content: "partial",
    rawStream: "partial",
    generationRunId: target.runId,
    status: "streaming",
    ...overrides
  };
}

function initialState(message = assistant()): SessionState {
  return {
    activeSessionId: target.sessionId,
    sessions: [
      {
        id: target.sessionId,
        title: "Session",
        createdAt: 1,
        updatedAt: 1,
        messages: [message],
        files: []
      }
    ]
  };
}

function createFixture(options: {
  message?: ClientMessage;
  execution?: Partial<ChatRunExecutionController>;
  saveOutcome?: "saved" | "failed" | "skipped";
} = {}) {
  let state = initialState(options.message);
  const effects: string[] = [];
  const warnings: Array<{ message: string; error?: unknown }> = [];
  const connection = { abort: () => effects.push("abort") };
  const execution = options.execution as ChatRunExecutionController | undefined;
  const ports: ChatRunAuthoritativeSettlementPorts = {
    getRuntime: () =>
      execution
        ? { waitUntilExecution: async () => execution }
        : undefined,
    updateState: (updater) => {
      effects.push("state");
      state = updater(state);
    },
    getThemeMode: () => "day",
    cancelReconnect: () => effects.push("reconnect"),
    getConnection: () => connection,
    removeConnection: () => effects.push("remove"),
    finishActivity: () => effects.push("finish"),
    saveNow: async () => {
      effects.push("save");
      return options.saveOutcome ?? "saved";
    },
    warn: (message, error) => warnings.push({ message, error })
  };
  return {
    ports,
    effects,
    warnings,
    get state() {
      return state;
    }
  };
}

describe("authoritative chat run settlement", () => {
  it("applies cancellation before aborting, releasing, and saving", async () => {
    const fixture = createFixture();

    const resolution = await settleAuthoritativeChatRun(
      target,
      { runId: target.runId, outcome: "cancelled", transitioned: true },
      undefined,
      fixture.ports
    );

    assert.equal(resolution, "applied");
    assert.equal(
      fixture.state.sessions[0].messages[0].generationOutcome,
      "cancelled"
    );
    assert.deepEqual(fixture.effects, [
      "state",
      "reconnect",
      "abort",
      "remove",
      "finish",
      "save"
    ]);
  });

  it("settles an attached execution before committing application state", async () => {
    const effects: string[] = [];
    const fixture = createFixture({
      execution: {
        settleAuthoritative: async () => {
          effects.push("execution");
          return {} as never;
        }
      }
    });
    const originalUpdate = fixture.ports.updateState;
    fixture.ports.updateState = (updater) => {
      effects.push("state");
      originalUpdate(updater);
    };

    await settleAuthoritativeChatRun(
      target,
      { runId: target.runId, outcome: "cancelled", transitioned: true },
      undefined,
      fixture.ports
    );

    assert.deepEqual(effects, ["execution", "state"]);
  });

  it("defers natural outcomes without an exact server terminal", async () => {
    for (const outcome of ["complete", "error"] as const) {
      const fixture = createFixture();
      const resolution = await settleAuthoritativeChatRun(
        target,
        { runId: target.runId, outcome, transitioned: false },
        undefined,
        fixture.ports
      );

      assert.equal(resolution, "deferred");
      assert.deepEqual(fixture.effects, ["state"]);
      assert.equal(fixture.state.sessions[0].messages[0].status, "streaming");
    }
  });

  it("does not overwrite an existing conflicting terminal", async () => {
    const fixture = createFixture({
      message: assistant({
        status: "complete",
        generationOutcome: "complete"
      })
    });

    const resolution = await settleAuthoritativeChatRun(
      target,
      { runId: target.runId, outcome: "cancelled", transitioned: true },
      undefined,
      fixture.ports
    );

    assert.equal(resolution, "deferred");
    assert.equal(
      fixture.state.sessions[0].messages[0].generationOutcome,
      "complete"
    );
    assert.deepEqual(fixture.effects, ["state"]);
  });

  it("contains execution and save failures after authoritative state applies", async () => {
    const executionFailure = new Error("execution failed");
    const fixture = createFixture({
      execution: {
        settleAuthoritative: async () => {
          throw executionFailure;
        }
      },
      saveOutcome: "failed"
    });

    assert.equal(
      await settleAuthoritativeChatRun(
        target,
        { runId: target.runId, outcome: "cancelled", transitioned: true },
        undefined,
        fixture.ports
      ),
      "applied"
    );
    assert.deepEqual(fixture.warnings, [
      {
        message: "Could not settle ChatHTML run through its active connection.",
        error: executionFailure
      },
      {
        message: "Could not persist authoritative ChatHTML run state.",
        error: undefined
      }
    ]);
  });

  it("bounds execution discovery and persistence without losing terminal state", async () => {
    const fixture = createFixture();
    fixture.ports.getRuntime = () => ({
      waitUntilExecution: () => new Promise(() => undefined)
    });
    fixture.ports.saveNow = () => new Promise(() => undefined);
    fixture.ports.executionWaitTimeoutMs = 5;
    fixture.ports.saveTimeoutMs = 5;

    assert.equal(
      await settleAuthoritativeChatRun(
        target,
        { runId: target.runId, outcome: "cancelled", transitioned: true },
        undefined,
        fixture.ports
      ),
      "applied"
    );
    assert.equal(
      fixture.state.sessions[0].messages[0].generationOutcome,
      "cancelled"
    );
    assert.deepEqual(
      fixture.warnings.map(({ message }) => message),
      [
        "Timed out waiting for the active ChatHTML connection.",
        "Timed out persisting authoritative ChatHTML run state."
      ]
    );
  });
});
