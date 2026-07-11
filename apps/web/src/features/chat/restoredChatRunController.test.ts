import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClientMessage } from "../../domain/chat/sessionModel";
import type { StreamingRenderer } from "../../runtime/streamui/types";
import type {
  ChatRunExecutionController,
  ChatRunExecutionControllerOptions,
  ChatRunExecutionOutcome
} from "./chatRunExecutionController";
import type { ChatRunState } from "./chatRunStateMachine";
import {
  runRestoredChatRun,
  type RestoredChatRunControllerOptions
} from "./restoredChatRunController";

const assistant: ClientMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "partial",
  rawStream: "raw",
  reasoning: "reasoning",
  generationRunId: "run-1",
  streamSequence: 4,
  status: "streaming"
};

function renderer(): StreamingRenderer {
  return {
    feed() {},
    replace() {},
    complete() {},
    getSnapshot: () => ({
      raw: "",
      completedHtml: "",
      iframeDocument: "",
      errors: [],
      status: "streaming"
    }),
    reset() {},
    onSnapshot: () => () => {},
    onError: () => () => {}
  };
}

function outcome(
  kind: ChatRunExecutionOutcome["kind"],
  state: ChatRunState
): ChatRunExecutionOutcome {
  return { kind, state } as ChatRunExecutionOutcome;
}

function createHarness(input: {
  response?: Response;
  finishKind?: ChatRunExecutionOutcome["kind"];
  transportKind?: ChatRunExecutionOutcome["kind"];
  terminal?: ChatRunState["terminal"];
} = {}) {
  const events: string[] = [];
  const patches: Array<{
    patch: Partial<ClientMessage>;
    phase: string | undefined;
  }> = [];
  const warnings: string[] = [];
  const connections = new Map<string, AbortController>();
  const renderers = new Map<string, StreamingRenderer>();
  let scheduledReconnect: (() => void) | undefined;
  let executionOptions: ChatRunExecutionControllerOptions | undefined;
  let targetStreaming = true;
  let state: ChatRunState = {
    runId: "run-1",
    raw: "raw",
    reasoning: "reasoning",
    streamSequence: 4,
    transportEnded: false,
    ...(input.terminal ? { terminal: input.terminal } : {})
  };

  const execution: ChatRunExecutionController = {
    handleLine(line) {
      events.push(`line:${line}`);
    },
    startReconcile() {
      events.push("reconcile:start");
    },
    async reconcileNow() {
      events.push("reconcile:now");
    },
    async settleAuthoritative() {
      throw new Error("unused");
    },
    async finishTransport() {
      events.push("transport:finish");
      return outcome(input.finishKind ?? "server-terminal", state);
    },
    async handleTransportError(error) {
      events.push(
        `transport:error:${error instanceof Error ? error.name : "unknown"}`
      );
      return outcome(input.transportKind ?? "unhandled", state);
    },
    checkpointStreaming: () => true,
    getState: () => state,
    dispose() {
      events.push("execution:dispose");
    }
  };

  const options: RestoredChatRunControllerOptions = {
    target: {
      runId: "run-1",
      sessionId: "session-1",
      assistant,
      themeMode: "night"
    },
    activityLease: {
      release: () => events.push("lease:release")
    },
    runtimeRegistration: {
      attachExecution(value) {
        assert.equal(value, execution);
        events.push("runtime:attach");
        return () => {
          events.push("runtime:detach");
          return true;
        };
      },
      end() {
        events.push("runtime:end");
        return true;
      }
    },
    connections,
    renderers,
    reconnectScheduler: {
      cancel: (runId) => events.push(`reconnect:cancel:${runId}`),
      markProgress: (runId) => events.push(`reconnect:progress:${runId}`),
      schedule(runId, reconnect) {
        events.push(`reconnect:schedule:${runId}`);
        scheduledReconnect = reconnect;
        return { scheduled: true, attempt: 1, delayMs: 1 };
      }
    },
    getClientId: () => "client-1",
    updateAssistant(patch, phase) {
      patches.push({ patch, phase });
      return true;
    },
    onMemory: () => {},
    loadServerMessage: async () => undefined,
    isTargetStillStreaming: () => targetStreaming,
    retry: () => events.push("retry"),
    createRenderer: () => renderer(),
    subscribeRenderer: ({ onSnapshot }) => {
      events.push("renderer:subscribe");
      onSnapshot(renderer().getSnapshot());
      return () => events.push("renderer:unsubscribe");
    },
    createExecution(value) {
      executionOptions = value;
      return execution;
    },
    requestEvents: async (runId, sequence, clientId, signal) => {
      assert.equal(runId, "run-1");
      assert.equal(sequence, state.streamSequence);
      assert.equal(clientId, "client-1");
      assert.equal(signal.aborted, false);
      events.push("request");
      return (
        input.response ??
        new Response(new Uint8Array([1]), { status: 200 })
      );
    },
    readLines: async (_body, onLine) => {
      events.push("read");
      onLine("event");
    },
    scheduleInterval: () => () => {},
    warn: (message) => warnings.push(message)
  };

  return {
    connections,
    events,
    execution,
    get executionOptions() {
      return executionOptions;
    },
    options,
    patches,
    renderers,
    runScheduledReconnect() {
      assert.ok(scheduledReconnect);
      scheduledReconnect();
    },
    setState(next: ChatRunState) {
      state = next;
    },
    setTargetStreaming(value: boolean) {
      targetStreaming = value;
    },
    warnings
  };
}

describe("restored chat run controller", () => {
  it("wires the restored stream and releases every resource after completion", async () => {
    const harness = createHarness();

    await runRestoredChatRun(harness.options);

    assert.equal(harness.connections.size, 0);
    assert.equal(harness.renderers.size, 0);
    assert.equal(harness.executionOptions?.initial?.raw, "raw");
    assert.equal(harness.executionOptions?.initial?.streamSequence, 4);
    assert.deepEqual(harness.patches[0].patch.snapshot?.status, "streaming");
    assert.deepEqual(harness.events, [
      "renderer:subscribe",
      "runtime:attach",
      "reconcile:start",
      "request",
      "read",
      "line:event",
      "transport:finish",
      "execution:dispose",
      "renderer:unsubscribe",
      "runtime:detach",
      "runtime:end",
      "lease:release"
    ]);
  });

  it("marks the assistant interrupted when renderer setup fails", async () => {
    const harness = createHarness();
    harness.options.createRenderer = () => {
      throw new Error("renderer failed");
    };

    await runRestoredChatRun(harness.options);

    assert.equal(harness.patches.at(-1)?.phase, "error");
    assert.equal(harness.patches.at(-1)?.patch.status, "error");
    assert.equal(harness.patches.at(-1)?.patch.generationOutcome, "error");
    assert.deepEqual(harness.events, ["runtime:end", "lease:release"]);
    assert.deepEqual(harness.warnings, ["Could not restore ChatHTML renderer."]);
  });

  it("cleans renderer setup when execution construction fails", async () => {
    const harness = createHarness();
    harness.options.createExecution = () => {
      throw new Error("execution failed");
    };

    await runRestoredChatRun(harness.options);

    assert.equal(harness.patches.at(-1)?.phase, "error");
    assert.equal(harness.connections.size, 0);
    assert.equal(harness.renderers.size, 0);
    assert.deepEqual(harness.events, [
      "renderer:subscribe",
      "renderer:unsubscribe",
      "runtime:end",
      "lease:release"
    ]);
  });

  it("accepts a server terminal found while reconciling a missing run", async () => {
    const terminal = {
      source: "server" as const,
      phase: "complete" as const,
      error: ""
    };
    const harness = createHarness({
      response: new Response(null, { status: 404 }),
      terminal
    });

    await runRestoredChatRun(harness.options);

    assert.equal(harness.patches.some(({ phase }) => phase === "error"), false);
    assert.equal(harness.events.includes("reconcile:now"), true);
  });

  it("marks a genuinely missing current run interrupted with its latest state", async () => {
    const harness = createHarness({
      response: new Response(null, { status: 404 })
    });
    harness.setState({
      runId: "run-1",
      raw: "latest raw",
      reasoning: "latest reasoning",
      streamSequence: 9,
      transportEnded: false
    });

    await runRestoredChatRun(harness.options);

    assert.deepEqual(harness.patches.at(-1), {
      phase: "error",
      patch: {
        content: "I could not complete that request.",
        reasoning: "latest reasoning",
        rawStream: "latest raw",
        streamSequence: 9,
        generationOutcome: "error",
        status: "error",
        error: "The stream was interrupted before it completed."
      }
    });
  });

  it("schedules a detached reconnect and rechecks the durable target", async () => {
    const harness = createHarness({ finishKind: "detached" });

    await runRestoredChatRun(harness.options);
    harness.runScheduledReconnect();
    assert.equal(harness.events.includes("retry"), true);

    const stopped = createHarness({ finishKind: "detached" });
    stopped.setTargetStreaming(false);
    await runRestoredChatRun(stopped.options);
    stopped.runScheduledReconnect();
    assert.equal(stopped.events.includes("retry"), false);
    assert.equal(stopped.events.includes("reconnect:cancel:run-1"), true);
  });

  it("does not schedule or delete a replacement connection", async () => {
    const harness = createHarness({ finishKind: "detached" });
    const replacement = new AbortController();
    harness.options.readLines = async () => {
      harness.connections.set("run-1", replacement);
    };

    await runRestoredChatRun(harness.options);

    assert.equal(harness.connections.get("run-1"), replacement);
    assert.equal(
      harness.events.some((event) => event.startsWith("reconnect:schedule")),
      false
    );
  });

  it("contains unsubscribe failures while completing ownership cleanup", async () => {
    const harness = createHarness();
    harness.options.subscribeRenderer = () => () => {
      throw new Error("unsubscribe failed");
    };

    await runRestoredChatRun(harness.options);

    assert.equal(harness.events.includes("runtime:end"), true);
    assert.equal(harness.events.includes("lease:release"), true);
    assert.deepEqual(harness.warnings, [
      "Could not unsubscribe ChatHTML renderer."
    ]);
  });
});
