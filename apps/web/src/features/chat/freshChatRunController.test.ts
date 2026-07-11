import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_API_SETTINGS,
  normalizeApiSettings
} from "../../core/apiSettings";
import { DEFAULT_SEARCH_SETTINGS } from "../../core/searchSettings";
import type { ClientMessage, SessionFile } from "../../domain/chat/sessionModel";
import type { StreamingRenderer } from "../../runtime/streamui/types";
import type {
  ChatRunExecutionController,
  ChatRunExecutionControllerOptions,
  ChatRunExecutionOutcome
} from "./chatRunExecutionController";
import type { FreshChatRunMessagePlan } from "./freshChatRunPlan";
import type { ChatRunState } from "./chatRunStateMachine";
import {
  runFreshChatRun,
  type FreshChatRunControllerOptions
} from "./freshChatRunController";

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

const userMessage: ClientMessage = {
  id: "user-1",
  role: "user",
  content: "hello",
  status: "complete"
};
const assistantMessage: ClientMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "",
  rawStream: "",
  generationRunId: "run-1",
  streamSequence: 0,
  status: "streaming"
};
const plan: FreshChatRunMessagePlan = {
  appendUserMessage: true,
  assistantId: "assistant-1",
  generationRunId: "run-1",
  previousMessages: [
    { id: "prior-1", role: "user", content: "prior", status: "complete" }
  ],
  preparedAttachmentFiles: {
    uploadedFiles: [],
    allAttachmentsCommitted: true,
    ephemeral: false
  },
  userMessage,
  assistantMessage
};

function executionOutcome(
  kind: ChatRunExecutionOutcome["kind"],
  state: ChatRunState
): ChatRunExecutionOutcome {
  return { kind, state } as ChatRunExecutionOutcome;
}

function createHarness(input: {
  response?: Response;
  finishKind?: ChatRunExecutionOutcome["kind"];
  transportKind?: ChatRunExecutionOutcome["kind"];
  managed?: boolean;
} = {}) {
  const events: string[] = [];
  const warnings: string[] = [];
  const patches: Array<{
    patch: Partial<ClientMessage>;
    phase: string | undefined;
  }> = [];
  const connections = new Map<string, AbortController>();
  const renderers = new Map<string, StreamingRenderer>();
  let executionOptions: ChatRunExecutionControllerOptions | undefined;
  let requestPayload: Record<string, unknown> | undefined;
  const state: ChatRunState = {
    runId: "run-1",
    raw: "partial raw",
    reasoning: "partial reasoning",
    streamSequence: 7,
    transportEnded: false
  };
  const execution: ChatRunExecutionController = {
    handleLine: (line) => events.push(`line:${line}`),
    startReconcile: () => events.push("reconcile:start"),
    async reconcileNow() {},
    async settleAuthoritative() {
      throw new Error("unused");
    },
    async finishTransport() {
      events.push("transport:finish");
      return executionOutcome(input.finishKind ?? "server-terminal", state);
    },
    async handleTransportError(error) {
      events.push(
        `transport:error:${error instanceof Error ? error.message : "unknown"}`
      );
      return executionOutcome(input.transportKind ?? "unhandled", state);
    },
    checkpointStreaming() {
      events.push("checkpoint");
      return true;
    },
    getState: () => state,
    dispose: () => events.push("execution:dispose")
  };

  const options: FreshChatRunControllerOptions = {
    sessionId: "session-1",
    plan,
    sendOptions: {
      onRunAccepted: () => events.push("accepted:observer")
    },
    requestApiSettings: normalizeApiSettings({
      ...DEFAULT_API_SETTINGS,
      apiKeySource: input.managed ? "managed" : "environment",
      providerId: input.managed ? "chathtml-cloud" : "openrouter"
    }),
    searchSettings: DEFAULT_SEARCH_SETTINGS,
    themeMode: "night",
    activityLease: {
      release: () => events.push("lease:release")
    },
    runtimeRegistration: {
      markAccepted() {
        events.push("accepted:mark");
        return true;
      },
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
    initializeSession: () => events.push("session:initialize"),
    discardUnacceptedRun: () => events.push("session:discard"),
    updateAssistant(patch, phase) {
      patches.push({ patch, phase });
      return true;
    },
    onMemory: () => {},
    loadServerMessage: async () => undefined,
    getClientId: () => "client-1",
    getSessionFiles: () => [],
    getCanvasContext: () => ({ width: 100 }),
    upsertSessionFiles: () => events.push("files:upsert"),
    refreshManagedAuth: () => events.push("auth:refresh"),
    createRenderer: () => {
      const value = renderer();
      value.onSnapshot = () => {
        events.push("renderer:subscribe");
        return () => events.push("renderer:unsubscribe");
      };
      return value;
    },
    createExecution(value) {
      executionOptions = value;
      return execution;
    },
    startRequest: async (payload, clientId, signal) => {
      assert.equal(clientId, "client-1");
      assert.equal(signal.aborted, false);
      requestPayload = payload as Record<string, unknown>;
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
    uploadArtifactFile: async () => {
      events.push("file:upload");
      return {
        id: "artifact-1",
        kind: "artifact",
        name: "artifact.html",
        mimeType: "text/html",
        size: 1,
        createdAt: 1
      } satisfies SessionFile;
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
    get requestPayload() {
      return requestPayload;
    },
    warnings
  };
}

describe("fresh chat run controller", () => {
  it("initializes, accepts, streams, and cleans up in ownership order", async () => {
    const harness = createHarness();

    await runFreshChatRun(harness.options);

    assert.equal(harness.connections.size, 0);
    assert.equal(harness.renderers.size, 0);
    assert.equal(harness.requestPayload?.sessionId, "session-1");
    assert.equal(harness.requestPayload?.runId, "run-1");
    assert.deepEqual(
      harness.events.slice(0, 10),
      [
        "renderer:subscribe",
        "session:initialize",
        "runtime:attach",
        "reconcile:start",
        "request",
        "accepted:mark",
        "accepted:observer",
        "read",
        "line:event",
        "transport:finish"
      ]
    );
    assert.deepEqual(harness.events.slice(-5), [
      "execution:dispose",
      "renderer:unsubscribe",
      "runtime:detach",
      "runtime:end",
      "lease:release"
    ]);
  });

  it("discards an unaccepted run when session initialization fails", async () => {
    const harness = createHarness();
    harness.options.initializeSession = () => {
      throw new Error("state failed");
    };

    await runFreshChatRun(harness.options);

    assert.deepEqual(harness.events, [
      "renderer:subscribe",
      "renderer:unsubscribe",
      "runtime:end",
      "lease:release",
      "session:discard"
    ]);
    assert.equal(harness.patches.length, 0);
    assert.deepEqual(harness.warnings, ["Could not initialize ChatHTML run."]);
  });

  it("discards and marks an error when execution setup fails", async () => {
    const harness = createHarness();
    harness.options.createExecution = () => {
      throw new Error("execution failed");
    };

    await runFreshChatRun(harness.options);

    assert.equal(harness.events.includes("session:discard"), true);
    assert.deepEqual(harness.patches.at(-1), {
      phase: "error",
      patch: {
        content: "I could not complete that request.",
        error: "The chat request could not be initialized.",
        generationOutcome: "error",
        status: "error"
      }
    });
  });

  it("records a sanitized pre-accept HTTP failure", async () => {
    const harness = createHarness({
      response: new Response("<html><body>bad gateway</body></html>", {
        status: 502,
        headers: { "content-type": "text/html" }
      })
    });

    await runFreshChatRun(harness.options);

    const terminal = harness.patches.at(-1);
    assert.equal(terminal?.phase, "error");
    assert.equal(terminal?.patch.status, "error");
    assert.equal(terminal?.patch.reasoning, "partial reasoning");
    assert.equal(terminal?.patch.rawStream, "partial raw");
    assert.match(terminal?.patch.error ?? "", /HTTP 502/);
  });

  it("checkpoints instead of replacing an accepted stream after transport failure", async () => {
    const harness = createHarness();
    harness.options.readLines = async () => {
      throw new Error("connection lost");
    };

    await runFreshChatRun(harness.options);

    assert.equal(harness.events.includes("checkpoint"), true);
    assert.equal(harness.patches.some(({ phase }) => phase === "error"), false);
  });

  it("checkpoints a clean detached EOF", async () => {
    const harness = createHarness({ finishKind: "detached" });

    await runFreshChatRun(harness.options);

    assert.equal(harness.events.includes("checkpoint"), true);
  });

  it("contains an acceptance observer failure after marking accepted", async () => {
    const harness = createHarness();
    harness.options.sendOptions.onRunAccepted = () => {
      harness.events.push("accepted:observer");
      throw new Error("observer failed");
    };

    await runFreshChatRun(harness.options);

    assert.ok(
      harness.events.indexOf("accepted:mark") <
        harness.events.indexOf("accepted:observer")
    );
    assert.equal(harness.events.includes("read"), true);
    assert.deepEqual(harness.warnings, [
      "Chat run acceptance observer failed."
    ]);
  });

  it("does not delete renderer or connection replacements during cleanup", async () => {
    const harness = createHarness();
    const replacementConnection = new AbortController();
    const replacementRenderer = renderer();
    harness.options.readLines = async () => {
      harness.connections.set("run-1", replacementConnection);
      harness.renderers.set("assistant-1", replacementRenderer);
    };

    await runFreshChatRun(harness.options);

    assert.equal(harness.connections.get("run-1"), replacementConnection);
    assert.equal(harness.renderers.get("assistant-1"), replacementRenderer);
  });

  it("uploads a completed artifact and refreshes managed account state", async () => {
    const harness = createHarness({ managed: true });
    harness.options.createExecution = (value) => {
      const base = harness.execution;
      return {
        ...base,
        async finishTransport() {
          await value.afterLocalComplete?.({
            state: {
              runId: "run-1",
              raw: "<streamui><p>Hello</p></streamui>",
              reasoning: "",
              streamSequence: 1,
              transportEnded: true
            },
            patch: {}
          });
          return executionOutcome("server-terminal", base.getState());
        }
      };
    };
    harness.options.runtimeRegistration.attachExecution = () => undefined;

    await runFreshChatRun(harness.options);

    assert.equal(harness.events.includes("file:upload"), true);
    assert.equal(harness.events.includes("files:upsert"), true);
    assert.equal(harness.events.includes("auth:refresh"), true);
  });
});
