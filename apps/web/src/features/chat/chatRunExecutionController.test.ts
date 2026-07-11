import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClientMessage } from "../../domain/chat/sessionModel";
import { createStreamingRenderer } from "../../runtime/streamui/streamingRenderer";
import type { ChatRunAssistantPhase } from "./chatRunRequest";
import {
  createChatRunExecutionController,
  type ChatRunExecutionControllerOptions
} from "./chatRunExecutionController";

type AppliedPatch = {
  patch: Partial<ClientMessage>;
  phase: ChatRunAssistantPhase;
};

function assistant(
  overrides: Partial<ClientMessage> = {}
): ClientMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    generationRunId: "run-1",
    rawStream: "",
    streamSequence: 0,
    status: "streaming",
    ...overrides
  };
}

function createFixture(
  overrides: Partial<ChatRunExecutionControllerOptions> = {}
) {
  const abortController = new AbortController();
  const renderer = createStreamingRenderer("day");
  const applied: AppliedPatch[] = [];
  const memories: string[] = [];
  const errors: Array<{ scope: string; error: unknown }> = [];
  const intervalTasks: Array<{
    task: () => void;
    intervalMs: number;
    cancelled: boolean;
  }> = [];
  let active = true;
  let aborts = 0;
  let progress = 0;
  let serverMessage: ClientMessage | undefined;
  let loadCalls = 0;

  const controller = createChatRunExecutionController({
    runId: "run-1",
    renderer,
    signal: abortController.signal,
    isConnectionCurrent: () => active,
    abortConnection: () => {
      aborts += 1;
      abortController.abort();
    },
    applyAssistant: (patch, phase) => {
      applied.push({ patch, phase });
      return true;
    },
    onMemory: (event) => {
      if (event.action === "delete" && typeof event.id === "string") {
        memories.push(event.id);
      }
    },
    loadServerMessage: async () => {
      loadCalls += 1;
      return serverMessage;
    },
    onProgress: () => {
      progress += 1;
    },
    onError: (scope, error) => errors.push({ scope, error }),
    scheduleInterval: (task, intervalMs) => {
      const scheduled = { task, intervalMs, cancelled: false };
      intervalTasks.push(scheduled);
      return () => {
        scheduled.cancelled = true;
      };
    },
    ...overrides
  });

  return {
    controller,
    renderer,
    abortController,
    applied,
    memories,
    errors,
    intervalTasks,
    setActive(value: boolean) {
      active = value;
    },
    setServerMessage(value: ClientMessage | undefined) {
      serverMessage = value;
    },
    get aborts() {
      return aborts;
    },
    get progress() {
      return progress;
    },
    get loadCalls() {
      return loadCalls;
    }
  };
}

describe("chat run execution controller", () => {
  it("projects content, reasoning, memory, and done through one sequenced state", () => {
    const fixture = createFixture();

    fixture.controller.handleLine(
      JSON.stringify({
        type: "content",
        text: "<chat>Hello</chat><streamui><main>Hi",
        runId: "run-1",
        seq: 1
      })
    );
    fixture.controller.handleLine(
      JSON.stringify({
        type: "content",
        text: "duplicate",
        runId: "run-1",
        seq: 1
      })
    );
    fixture.controller.handleLine(
      JSON.stringify({
        type: "reasoning",
        text: "Think",
        runId: "run-1",
        seq: 2
      })
    );
    fixture.controller.handleLine(
      JSON.stringify({
        type: "memory",
        action: "delete",
        id: "memory-1",
        runId: "run-1",
        seq: 3
      })
    );
    fixture.controller.handleLine(
      JSON.stringify({
        type: "done",
        status: "complete",
        runId: "run-1",
        seq: 4
      })
    );

    assert.equal(fixture.controller.getState().raw.includes("duplicate"), false);
    assert.equal(fixture.controller.getState().reasoning, "Think");
    assert.equal(fixture.controller.getState().streamSequence, 4);
    assert.equal(fixture.controller.getState().terminal?.phase, "complete");
    assert.equal(fixture.renderer.getSnapshot().raw, "<main>Hi");
    assert.deepEqual(fixture.memories, ["memory-1"]);
    assert.equal(fixture.progress, 4);
    assert.deepEqual(
      fixture.applied.map(({ phase }) => phase),
      ["streaming", "streaming", "streaming", "streaming"]
    );
  });

  it("locks cancellation before buffered stream and server events can write", async () => {
    const fixture = createFixture();
    fixture.setActive(false);
    fixture.controller.handleLine(
      JSON.stringify({ type: "content", text: "late", seq: 1 })
    );
    fixture.controller.handleLine(
      JSON.stringify({
        type: "memory",
        action: "delete",
        id: "late-memory",
        seq: 2
      })
    );
    fixture.setServerMessage(
      assistant({ content: "Server done", status: "complete", streamSequence: 3 })
    );
    await fixture.controller.reconcileNow();

    assert.equal(fixture.controller.getState().terminal?.source, "cancel");
    assert.equal(fixture.controller.getState().raw, "");
    assert.deepEqual(fixture.applied, []);
    assert.deepEqual(fixture.memories, []);
    assert.equal(fixture.aborts, 0);
  });

  it("applies a server terminal before aborting the connection", async () => {
    const effects: string[] = [];
    const fixture = createFixture({
      applyAssistant: (_patch, phase) => {
        effects.push(`apply:${phase}`);
        return true;
      },
      abortConnection: () => effects.push("abort")
    });
    fixture.setServerMessage(
      assistant({
        content: "Done",
        rawStream: "server raw",
        status: "complete"
      })
    );

    await fixture.controller.reconcileNow();

    assert.deepEqual(effects, ["apply:complete", "abort"]);
    assert.equal(fixture.controller.getState().terminal?.source, "server");
  });

  it("coalesces reconciliation, polls once, and ignores in-flight work after dispose", async () => {
    let resolveLoad: ((message: ClientMessage | undefined) => void) | undefined;
    let loadCalls = 0;
    const fixture = createFixture({
      loadServerMessage: () => {
        loadCalls += 1;
        return new Promise((resolve) => {
          resolveLoad = resolve;
        });
      }
    });

    fixture.controller.startReconcile();
    const sameFlight = fixture.controller.reconcileNow();
    assert.equal(loadCalls, 1);
    assert.equal(fixture.intervalTasks.length, 1);
    assert.equal(fixture.intervalTasks[0].intervalMs, 1_500);

    fixture.controller.dispose();
    assert.equal(fixture.intervalTasks[0].cancelled, true);
    resolveLoad?.(
      assistant({ content: "Late", status: "complete", streamSequence: 2 })
    );
    await sameFlight;

    assert.deepEqual(fixture.applied, []);
    assert.equal(fixture.controller.getState().terminal, undefined);
  });

  it("ignores buffered stream events after dispose", () => {
    const fixture = createFixture();
    fixture.controller.dispose();

    fixture.controller.handleLine(
      JSON.stringify({ type: "content", text: "late", seq: 1 })
    );

    assert.equal(fixture.controller.getState().raw, "");
    assert.equal(fixture.progress, 0);
    assert.deepEqual(fixture.applied, []);
  });

  it("contains reconciliation failures and remains reusable", async () => {
    const failure = new Error("sync failed");
    let attempts = 0;
    const fixture = createFixture({
      loadServerMessage: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw failure;
        }
        return assistant({ rawStream: "next", streamSequence: 1 });
      }
    });

    await fixture.controller.reconcileNow();
    await fixture.controller.reconcileNow();

    assert.deepEqual(fixture.errors, [{ scope: "reconcile", error: failure }]);
    assert.equal(fixture.controller.getState().raw, "next");
  });

  it("returns detached at EOF without done and checkpoints without completing", async () => {
    const fixture = createFixture();
    fixture.controller.handleLine("partial text");

    const outcome = await fixture.controller.finishTransport();
    const checkpointed = fixture.controller.checkpointStreaming();

    assert.equal(outcome.kind, "detached");
    assert.equal(checkpointed, true);
    assert.equal(fixture.renderer.getSnapshot().status, "idle");
    assert.deepEqual(fixture.applied.at(-1), {
      phase: "streaming",
      patch: {
        reasoning: "",
        rawStream: "partial text",
        streamSequence: 0,
        generationOutcome: undefined,
        status: "streaming"
      }
    });
  });

  it("finalizes a local completion and runs its completion effect once", async () => {
    const completions: Array<Partial<ClientMessage>> = [];
    const fixture = createFixture({
      afterLocalComplete: async ({ patch }) => {
        completions.push(patch);
      }
    });
    fixture.controller.handleLine(
      JSON.stringify({
        type: "content",
        text: "<chat>Done</chat><streamui><main>Artifact</main></streamui>",
        seq: 1
      })
    );
    fixture.controller.handleLine(
      JSON.stringify({ type: "done", status: "complete", seq: 2 })
    );

    const first = await fixture.controller.finishTransport();
    const second = await fixture.controller.finishTransport();

    assert.equal(first.kind, "local-terminal");
    assert.equal(second, first);
    assert.equal(
      first.kind === "local-terminal" ? first.presentation.phase : undefined,
      "complete"
    );
    assert.equal(fixture.renderer.getSnapshot().status, "complete");
    assert.equal(completions.length, 1);
  });

  it("uses an explicit done error when transport fails afterward", async () => {
    const fixture = createFixture();
    fixture.controller.handleLine(
      JSON.stringify({ type: "content", text: "<chat>Partial</chat>", seq: 1 })
    );
    fixture.controller.handleLine(
      JSON.stringify({
        type: "done",
        status: "error",
        error: "Provider failed",
        seq: 2
      })
    );

    const outcome = await fixture.controller.handleTransportError(
      new Error("reader failed")
    );

    assert.equal(outcome.kind, "local-terminal");
    assert.equal(
      outcome.kind === "local-terminal" ? outcome.presentation.phase : undefined,
      "error"
    );
    assert.equal(fixture.applied.at(-1)?.patch.error, "Provider failed");
  });

  it("rolls an explicit cancelled done event through the cancelled phase", async () => {
    const fixture = createFixture();
    fixture.controller.handleLine(
      JSON.stringify({ type: "content", text: "partial", seq: 1 })
    );
    fixture.controller.handleLine(
      JSON.stringify({ type: "done", status: "cancelled", seq: 2 })
    );

    const outcome = await fixture.controller.finishTransport();

    assert.equal(outcome.kind, "local-terminal");
    assert.equal(
      outcome.kind === "local-terminal" ? outcome.presentation.phase : undefined,
      "cancelled"
    );
    assert.equal(fixture.applied.at(-1)?.phase, "cancelled");
    assert.equal(fixture.applied.at(-1)?.patch.status, "complete");
  });

  it("maps aborts to cancellation and leaves ordinary failures unhandled", async () => {
    const cancelled = createFixture();
    cancelled.abortController.abort();
    const cancelledOutcome = await cancelled.controller.handleTransportError(
      new Error("aborted")
    );
    const failed = createFixture();
    const failedOutcome = await failed.controller.handleTransportError(
      new Error("network failed")
    );

    assert.equal(cancelledOutcome.kind, "local-terminal");
    assert.equal(
      cancelledOutcome.kind === "local-terminal"
        ? cancelledOutcome.presentation.phase
        : undefined,
      "cancelled"
    );
    assert.equal(failedOutcome.kind, "unhandled");
    assert.deepEqual(failed.applied, []);
  });

  it("does not let a replaced connection apply its local terminal", async () => {
    const fixture = createFixture();
    fixture.controller.handleLine(
      JSON.stringify({ type: "done", status: "error", error: "Late", seq: 1 })
    );
    fixture.setActive(false);

    const outcome = await fixture.controller.handleTransportError(
      new Error("replaced")
    );

    assert.equal(outcome.kind, "stale");
    assert.deepEqual(fixture.applied, [
      { patch: { streamSequence: 1 }, phase: "streaming" }
    ]);
  });

  it("checks ownership before a local completion can notify renderer subscribers", async () => {
    const fixture = createFixture();
    fixture.controller.handleLine(
      JSON.stringify({
        type: "content",
        text: "<chat>Done</chat><streamui><main>Artifact</main></streamui>",
        seq: 1
      })
    );
    fixture.controller.handleLine(
      JSON.stringify({ type: "done", status: "complete", seq: 2 })
    );
    let snapshotWrites = 0;
    const unsubscribe = fixture.renderer.onSnapshot(() => {
      snapshotWrites += 1;
    });
    const snapshotWritesBeforeReplacement = snapshotWrites;
    const rendererStatusBeforeReplacement =
      fixture.renderer.getSnapshot().status;
    fixture.setActive(false);

    const outcome = await fixture.controller.finishTransport();
    unsubscribe();

    assert.equal(outcome.kind, "stale");
    assert.equal(snapshotWrites, snapshotWritesBeforeReplacement);
    assert.equal(
      fixture.renderer.getSnapshot().status,
      rendererStatusBeforeReplacement
    );
  });

  it("does not checkpoint streaming state through a replaced connection", () => {
    const fixture = createFixture();
    fixture.controller.handleLine("partial");
    const appliedBeforeReplacement = fixture.applied.length;
    fixture.setActive(false);

    assert.equal(fixture.controller.checkpointStreaming(), false);
    assert.equal(fixture.applied.length, appliedBeforeReplacement);
  });

  it("lets final server reconciliation override a local done event", async () => {
    let completionEffects = 0;
    const fixture = createFixture({
      afterLocalComplete: () => {
        completionEffects += 1;
      }
    });
    fixture.controller.handleLine(
      JSON.stringify({ type: "done", status: "complete", seq: 1 })
    );
    fixture.setServerMessage(
      assistant({
        content: "Server failed",
        status: "error",
        error: "Failure",
        streamSequence: 1
      })
    );

    const outcome = await fixture.controller.finishTransport();

    assert.equal(outcome.kind, "server-terminal");
    assert.equal(fixture.applied.at(-1)?.phase, "error");
    assert.equal(completionEffects, 0);
    assert.equal(fixture.aborts, 1);
  });

  it("settles an authoritative cancellation before aborting transport", async () => {
    const effects: string[] = [];
    const fixture = createFixture({
      applyAssistant: (patch, phase) => {
        effects.push(`apply:${phase}:${patch.generationOutcome}`);
        return true;
      },
      abortConnection: () => effects.push("abort")
    });
    fixture.controller.handleLine(
      JSON.stringify({ type: "content", text: "partial", seq: 1 })
    );

    const settlement = await fixture.controller.settleAuthoritative({
      outcome: "cancelled"
    });
    fixture.controller.handleLine(
      JSON.stringify({ type: "content", text: "late", seq: 2 })
    );

    assert.equal(settlement.kind, "applied");
    assert.equal(
      settlement.kind === "applied" ? settlement.applied : undefined,
      true
    );
    assert.deepEqual(effects, [
      "apply:streaming:undefined",
      "apply:cancelled:cancelled",
      "abort"
    ]);
    assert.deepEqual(fixture.controller.getState().terminal, {
      source: "server",
      phase: "cancelled",
      error: ""
    });
    assert.equal(fixture.controller.getState().raw, "partial");
  });

  it("applies exact complete and error messages as authoritative terminals", async () => {
    for (const outcome of ["complete", "error"] as const) {
      const fixture = createFixture();
      const message = assistant({
        content: outcome === "complete" ? "Done" : "Failed",
        status: outcome,
        generationOutcome: outcome,
        error: outcome === "error" ? "Provider failed" : undefined,
        streamSequence: 2
      });

      const settlement = await fixture.controller.settleAuthoritative({
        outcome,
        message
      });

      assert.equal(settlement.kind, "applied");
      assert.equal(fixture.controller.getState().terminal?.source, "server");
      assert.equal(fixture.controller.getState().terminal?.phase, outcome);
      assert.equal(fixture.applied.at(-1)?.phase, outcome);
      assert.equal(fixture.aborts, 1);
    }
  });

  it("requires an exact terminal message for authoritative complete and error", async () => {
    const cases = [
      { outcome: "complete" as const, message: undefined },
      {
        outcome: "complete" as const,
        message: assistant({ generationRunId: "run-2", status: "complete" })
      },
      {
        outcome: "error" as const,
        message: assistant({ status: "streaming", generationOutcome: undefined })
      },
      {
        outcome: "error" as const,
        message: assistant({ status: "complete", generationOutcome: "complete" })
      }
    ];

    for (const input of cases) {
      const fixture = createFixture();
      const settlement = await fixture.controller.settleAuthoritative(input);

      assert.equal(settlement.kind, "deferred");
      assert.equal(fixture.controller.getState().terminal, undefined);
      assert.deepEqual(fixture.applied, []);
      assert.equal(fixture.aborts, 0);
    }
  });

  it("uses an exact durable cancelled message when one is available", async () => {
    const fixture = createFixture();
    const message = assistant({
      content: "Server partial",
      rawStream: "server partial",
      status: "complete",
      generationOutcome: "cancelled",
      streamSequence: 4
    });

    const settlement = await fixture.controller.settleAuthoritative({
      outcome: "cancelled",
      message
    });

    assert.equal(settlement.kind, "applied");
    assert.equal(fixture.applied.at(-1)?.phase, "cancelled");
    assert.equal(fixture.applied.at(-1)?.patch.content, "Server partial");
    assert.equal(fixture.applied.at(-1)?.patch.generationOutcome, "cancelled");
    assert.equal(fixture.aborts, 1);
  });

  it("does not settle an authoritative result through a replaced execution", async () => {
    const fixture = createFixture();
    fixture.setActive(false);

    const settlement = await fixture.controller.settleAuthoritative({
      outcome: "cancelled"
    });

    assert.equal(settlement.kind, "stale");
    assert.equal(fixture.controller.getState().terminal, undefined);
    assert.deepEqual(fixture.applied, []);
    assert.equal(fixture.aborts, 0);
  });

  it("isolates completion-effect failures and skips them for unapplied patches", async () => {
    const failure = new Error("upload failed");
    let completionCalls = 0;
    const fixture = createFixture({
      applyAssistant: () => false,
      afterLocalComplete: () => {
        completionCalls += 1;
        throw failure;
      }
    });
    fixture.controller.handleLine(
      JSON.stringify({ type: "done", status: "complete", seq: 1 })
    );
    await fixture.controller.finishTransport();

    assert.equal(completionCalls, 0);
    assert.deepEqual(fixture.errors, []);

    const applied = createFixture({
      afterLocalComplete: () => {
        throw failure;
      }
    });
    applied.controller.handleLine(
      JSON.stringify({ type: "done", status: "complete", seq: 1 })
    );
    await applied.controller.finishTransport();
    assert.deepEqual(applied.errors, [
      { scope: "after-local-complete", error: failure }
    ]);
  });
});
