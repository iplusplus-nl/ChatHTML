import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createChatRunTerminalCoordinator,
  waitForChatRunCancellationResponse
} from "./chatRunTerminalCoordinator.js";

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("chat run terminal coordinator", () => {
  it("lets the first terminal outcome win and shares its persistence", async () => {
    const pending = deferred();
    const transitions: string[] = [];
    const persistCalls: string[] = [];
    const coordinator = createChatRunTerminalCoordinator({
      onTransition: ({ outcome }) => transitions.push(outcome),
      persist: async ({ outcome }) => {
        persistCalls.push(outcome);
        await pending.promise;
      }
    });

    const cancelled = coordinator.transition("cancelled");
    const completed = coordinator.transition("complete");

    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(cancelled.transitioned, true);
    assert.equal(completed.outcome, "cancelled");
    assert.equal(completed.transitioned, false);
    assert.equal(cancelled.persistence, completed.persistence);
    assert.deepEqual(transitions, ["cancelled"]);
    assert.deepEqual(persistCalls, ["cancelled"]);

    pending.resolve();
    await cancelled.persistence;
  });

  it("preserves complete and error winners", async () => {
    for (const outcome of ["complete", "error"] as const) {
      const transitions: string[] = [];
      const coordinator = createChatRunTerminalCoordinator({
        onTransition: ({ outcome: value }) => transitions.push(value),
        persist: async () => undefined
      });

      const first = coordinator.transition(
        outcome,
        outcome === "error" ? "Provider failed" : undefined
      );
      const cancelled = coordinator.transition("cancelled");
      await first.persistence;

      assert.equal(first.outcome, outcome);
      assert.equal(cancelled.outcome, outcome);
      assert.deepEqual(transitions, [outcome]);
    }
  });

  it("latches the first outcome before synchronous transition callbacks", async () => {
    const transitions: string[] = [];
    const persistCalls: string[] = [];
    let nestedResult:
      | ReturnType<ReturnType<typeof createChatRunTerminalCoordinator>["transition"]>
      | undefined;
    let coordinator: ReturnType<typeof createChatRunTerminalCoordinator>;
    coordinator = createChatRunTerminalCoordinator({
      onTransition: ({ outcome }) => {
        transitions.push(outcome);
        nestedResult = coordinator.transition("complete");
      },
      persist: async ({ outcome }) => {
        persistCalls.push(outcome);
      }
    });

    const outerResult = coordinator.transition("cancelled");
    await outerResult.persistence;

    assert.equal(outerResult.outcome, "cancelled");
    assert.equal(outerResult.transitioned, true);
    assert.equal(nestedResult?.outcome, "cancelled");
    assert.equal(nestedResult?.transitioned, false);
    assert.equal(nestedResult?.persistence, outerResult.persistence);
    assert.deepEqual(transitions, ["cancelled"]);
    assert.deepEqual(persistCalls, ["cancelled"]);
  });

  it("propagates persistence failure and retries it idempotently", async () => {
    const failure = new Error("disk failed");
    let attempts = 0;
    const coordinator = createChatRunTerminalCoordinator({
      onTransition: () => undefined,
      persist: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw failure;
        }
      }
    });

    const first = coordinator.transition("cancelled");
    await assert.rejects(first.persistence, failure);
    const retry = coordinator.transition("cancelled");
    await retry.persistence;

    assert.equal(first.transitioned, true);
    assert.equal(retry.transitioned, false);
    assert.equal(attempts, 2);
  });

  it("does not resolve a cancellation response before persistence", async () => {
    const pending = deferred();
    const coordinator = createChatRunTerminalCoordinator({
      onTransition: () => undefined,
      persist: () => pending.promise
    });
    let resolved = false;
    const response = waitForChatRunCancellationResponse(
      "run-1",
      coordinator.transition("cancelled")
    ).then((value) => {
      resolved = true;
      return value;
    });

    await Promise.resolve();
    assert.equal(resolved, false);
    pending.resolve();
    assert.deepEqual(await response, {
      runId: "run-1",
      outcome: "cancelled",
      transitioned: true
    });
  });
});
