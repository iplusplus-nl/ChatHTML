import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClientMessage } from "../../domain/chat/sessionModel";
import type { CancelChatRunResult } from "./chatApi";
import {
  createChatRunCancellationController,
  isExactChatRunTerminalMessage,
  type ChatRunCancellationControllerOptions,
  type ChatRunCancellationTarget
} from "./chatRunCancellationController";

const target: ChatRunCancellationTarget = {
  runId: "run-1",
  sessionId: "session-1",
  assistantId: "assistant-1"
};

function result(
  outcome: CancelChatRunResult["outcome"] = "cancelled"
): CancelChatRunResult {
  return { runId: target.runId, outcome, transitioned: true };
}

function assistant(
  outcome: CancelChatRunResult["outcome"],
  overrides: Partial<ClientMessage> = {}
): ClientMessage {
  return {
    id: target.assistantId,
    role: "assistant",
    content: "terminal",
    generationRunId: target.runId,
    generationOutcome: outcome,
    status: outcome === "error" ? "error" : "complete",
    ...overrides
  };
}

function createFixture(
  overrides: Partial<ChatRunCancellationControllerOptions> = {}
) {
  const effects: string[] = [];
  const errors: Array<{ scope: string; error: unknown }> = [];
  let accepted = true;
  let response = result();
  let message: ClientMessage | undefined = assistant("cancelled");
  let settleResult: "applied" | "deferred" = "applied";

  const controller = createChatRunCancellationController({
    waitUntilAccepted: async () => {
      effects.push("accepted");
      return accepted;
    },
    request: async () => {
      effects.push("request");
      return response;
    },
    loadMessage: async () => {
      effects.push("load");
      return message;
    },
    settle: async (_target, settled, loaded) => {
      effects.push(`settle:${settled.outcome}:${loaded ? "message" : "fallback"}`);
      return settleResult;
    },
    reconcile: async () => {
      effects.push("reconcile");
    },
    onError: (scope, error) => errors.push({ scope, error }),
    ...overrides
  });

  return {
    controller,
    effects,
    errors,
    setAccepted(value: boolean) {
      accepted = value;
    },
    setResponse(value: CancelChatRunResult) {
      response = value;
    },
    setMessage(value: ClientMessage | undefined) {
      message = value;
    },
    setSettleResult(value: "applied" | "deferred") {
      settleResult = value;
    }
  };
}

async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe("chat run cancellation controller", () => {
  it("waits for server acceptance before requesting cancellation", async () => {
    let releaseAcceptance: ((accepted: boolean) => void) | undefined;
    const fixture = createFixture({
      waitUntilAccepted: () =>
        new Promise((resolve) => {
          releaseAcceptance = resolve;
        })
    });

    const pending = fixture.controller.cancel(target);
    await Promise.resolve();
    assert.deepEqual(fixture.effects, []);

    releaseAcceptance?.(true);
    const resolution = await pending;

    assert.equal(resolution.kind, "applied");
    assert.deepEqual(fixture.effects, [
      "request",
      "load",
      "settle:cancelled:message"
    ]);
  });

  it("has no server or local side effects when a run ends before acceptance", async () => {
    const fixture = createFixture();
    fixture.setAccepted(false);

    const resolution = await fixture.controller.cancel(target);

    assert.equal(resolution.kind, "not-accepted");
    assert.deepEqual(fixture.effects, ["accepted"]);
  });

  it("probes the authoritative endpoint after acceptance times out", async () => {
    const timers: Array<{ task: () => void; cancelled: boolean }> = [];
    const fixture = createFixture({
      waitUntilAccepted: () => new Promise(() => undefined),
      acceptanceTimeoutMs: 10,
      scheduleTimeout: (task) => {
        const timer = { task, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      }
    });

    const cancelling = fixture.controller.cancel(target);
    assert.equal(fixture.controller.isPending(target.runId), true);
    timers[0].task();
    const resolution = await cancelling;

    assert.equal(resolution.kind, "applied");
    assert.deepEqual(fixture.effects, [
      "request",
      "load",
      "settle:cancelled:message"
    ]);
    assert.equal(fixture.errors[0].scope, "acceptance");
    assert.match(String(fixture.errors[0].error), /acceptance timed out/);
  });

  it("times out a stuck cancellation request and reconciles without settlement", async () => {
    const timers: Array<{ task: () => void; cancelled: boolean }> = [];
    let requestSignal: AbortSignal | undefined;
    const fixture = createFixture({
      request: (_target, signal) => {
        requestSignal = signal;
        return new Promise(() => undefined);
      },
      requestTimeoutMs: 10,
      scheduleTimeout: (task) => {
        const timer = { task, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      }
    });

    const cancelling = fixture.controller.cancel(target);
    await flushMicrotasks();
    const requestTimer = timers.find((timer) => !timer.cancelled);
    assert.ok(requestTimer);
    requestTimer.task();
    const resolution = await cancelling;

    assert.equal(resolution.kind, "deferred");
    assert.deepEqual(fixture.effects, ["accepted", "reconcile"]);
    assert.equal(fixture.errors[0].scope, "request");
    assert.match(String(fixture.errors[0].error), /cancellation timed out/);
    assert.equal(requestSignal?.aborted, true);
    await Promise.resolve();
    assert.equal(fixture.controller.isPending(target.runId), false);
  });

  it("bounds a stuck message load and still applies cancellation fallback", async () => {
    const timers: Array<{ task: () => void; cancelled: boolean }> = [];
    const fixture = createFixture({
      loadMessage: () => new Promise(() => undefined),
      loadTimeoutMs: 10,
      scheduleTimeout: (task) => {
        const timer = { task, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      }
    });

    const cancelling = fixture.controller.cancel(target);
    await flushMicrotasks();
    const loadTimer = timers.find((timer) => !timer.cancelled);
    assert.ok(loadTimer);
    loadTimer.task();

    assert.equal((await cancelling).kind, "applied");
    assert.deepEqual(fixture.effects, [
      "accepted",
      "request",
      "settle:cancelled:fallback"
    ]);
    assert.equal(fixture.errors[0].scope, "load");
    assert.match(String(fixture.errors[0].error), /message load timed out/);
    await Promise.resolve();
    assert.equal(fixture.controller.isPending(target.runId), false);
  });

  it("bounds stuck settlement and reconciliation before releasing ownership", async () => {
    const fixture = createFixture({
      settle: () => new Promise(() => undefined),
      reconcile: () => new Promise(() => undefined),
      settleTimeoutMs: 5,
      reconcileTimeoutMs: 5
    });

    assert.equal((await fixture.controller.cancel(target)).kind, "deferred");
    assert.deepEqual(
      fixture.errors.map(({ scope }) => scope),
      ["settle", "reconcile"]
    );
    await Promise.resolve();
    assert.equal(fixture.controller.isPending(target.runId), false);
  });

  it("deduplicates concurrent cancellation attempts by run id", async () => {
    let releaseRequest: ((value: CancelChatRunResult) => void) | undefined;
    const fixture = createFixture({
      request: () =>
        new Promise((resolve) => {
          fixture.effects.push("request");
          releaseRequest = resolve;
        })
    });

    const first = fixture.controller.cancel(target);
    const second = fixture.controller.cancel({ ...target });
    assert.equal(first, second);
    assert.equal(fixture.controller.isPending(target.runId), true);
    await flushMicrotasks();
    assert.ok(releaseRequest);
    releaseRequest?.(result());

    assert.equal((await first).kind, "applied");
    await Promise.resolve();
    assert.equal(fixture.controller.isPending(target.runId), false);
    assert.equal(fixture.effects.filter((effect) => effect === "request").length, 1);
  });

  it("reconciles request failures without settling a cancellation", async () => {
    const failure = new Error("network failed");
    const fixture = createFixture({
      request: async () => {
        fixture.effects.push("request");
        throw failure;
      }
    });

    const resolution = await fixture.controller.cancel(target);

    assert.equal(resolution.kind, "deferred");
    assert.deepEqual(fixture.effects, ["accepted", "request", "reconcile"]);
    assert.deepEqual(fixture.errors, [{ scope: "request", error: failure }]);
  });

  it("settles authoritative cancellation even if loading its message fails", async () => {
    const failure = new Error("sync failed");
    const fixture = createFixture({
      loadMessage: async () => {
        fixture.effects.push("load");
        throw failure;
      }
    });

    const resolution = await fixture.controller.cancel(target);

    assert.equal(resolution.kind, "applied");
    assert.deepEqual(fixture.effects, [
      "accepted",
      "request",
      "load",
      "settle:cancelled:fallback"
    ]);
    assert.deepEqual(fixture.errors, [{ scope: "load", error: failure }]);
  });

  it("requires exact messages for natural complete and error winners", async () => {
    for (const outcome of ["complete", "error"] as const) {
      const fixture = createFixture();
      fixture.setResponse(result(outcome));
      fixture.setMessage(
        assistant(outcome, { generationRunId: "another-run" })
      );

      const resolution = await fixture.controller.cancel(target);

      assert.equal(resolution.kind, "deferred");
      assert.deepEqual(fixture.effects, [
        "accepted",
        "request",
        "load",
        "reconcile"
      ]);
    }
  });

  it("passes exact natural terminal winners to settlement", async () => {
    for (const outcome of ["complete", "error"] as const) {
      const fixture = createFixture();
      fixture.setResponse(result(outcome));
      fixture.setMessage(assistant(outcome));

      const resolution = await fixture.controller.cancel(target);

      assert.equal(resolution.kind, "applied");
      assert.equal(
        fixture.effects.at(-1),
        `settle:${outcome}:message`
      );
    }
  });

  it("reconciles a deferred or failed settlement", async () => {
    const failure = new Error("apply failed");
    const deferred = createFixture();
    deferred.setSettleResult("deferred");
    assert.equal((await deferred.controller.cancel(target)).kind, "deferred");
    assert.equal(deferred.effects.at(-1), "reconcile");

    const failed = createFixture({
      settle: async () => {
        failed.effects.push("settle");
        throw failure;
      }
    });
    assert.equal((await failed.controller.cancel(target)).kind, "deferred");
    assert.deepEqual(failed.errors, [{ scope: "settle", error: failure }]);
    assert.equal(failed.effects.at(-1), "reconcile");
  });

  it("validates exact assistant, run, and terminal outcome identity", () => {
    assert.equal(
      isExactChatRunTerminalMessage(target, "cancelled", assistant("cancelled")),
      true
    );
    assert.equal(
      isExactChatRunTerminalMessage(
        target,
        "cancelled",
        assistant("cancelled", { id: "assistant-2" })
      ),
      false
    );
    assert.equal(
      isExactChatRunTerminalMessage(target, "cancelled", assistant("complete")),
      false
    );
    assert.equal(
      isExactChatRunTerminalMessage(
        target,
        "complete",
        assistant("complete", { status: "streaming" })
      ),
      false
    );
    assert.equal(
      isExactChatRunTerminalMessage(
        target,
        "error",
        assistant("error", { status: "complete" })
      ),
      false
    );
    assert.equal(
      isExactChatRunTerminalMessage(
        target,
        "complete",
        assistant("complete", { role: "user" })
      ),
      false
    );
  });
});
