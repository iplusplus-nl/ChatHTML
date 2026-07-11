import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createChatRunCancellationIntentRegistry,
  executeAcceptedChatRun
} from "./chatRunCancellationIntent.js";

describe("unknown chat run cancellation intents", () => {
  it("registers one-shot intents and reports duplicate registration", () => {
    const registry = createChatRunCancellationIntentRegistry();

    assert.equal(registry.register("run-1"), true);
    assert.equal(registry.register("run-1"), false);
    assert.equal(registry.has("run-1"), true);
    assert.equal(registry.consume("run-1"), true);
    assert.equal(registry.consume("run-1"), false);
    assert.equal(registry.size(), 0);
  });

  it("expires intents after a short TTL and refreshes duplicate intent age", () => {
    let currentTime = 1_000;
    const registry = createChatRunCancellationIntentRegistry({
      ttlMs: 50,
      now: () => currentTime
    });

    assert.equal(registry.register("run-1"), true);
    currentTime = 1_040;
    assert.equal(registry.register("run-1"), false);
    currentTime = 1_080;
    assert.equal(registry.consume("run-1"), true);

    assert.equal(registry.register("run-2"), true);
    currentTime = 1_131;
    assert.equal(registry.consume("run-2"), false);
  });

  it("evicts the oldest intent when the fixed capacity is reached", () => {
    const registry = createChatRunCancellationIntentRegistry({
      capacity: 2
    });

    assert.equal(registry.register("run-1"), true);
    assert.equal(registry.register("run-2"), true);
    assert.equal(registry.register("run-3"), true);

    assert.equal(registry.has("run-1"), false);
    assert.equal(registry.has("run-2"), true);
    assert.equal(registry.has("run-3"), true);
    assert.equal(registry.size(), 2);
  });

  it("does not retain invalid identifiers", () => {
    const registry = createChatRunCancellationIntentRegistry();

    assert.equal(registry.register(""), false);
    assert.equal(registry.register("x".repeat(161)), false);
    assert.equal(registry.size(), 0);
  });
});

describe("accepted chat run execution", () => {
  it("persists initial state and authoritative cancellation without starting the provider", async () => {
    const order: string[] = [];

    const outcome = await executeAcceptedChatRun({
      preCancelled: true,
      persistInitial: async () => {
        order.push("initial:start");
        await Promise.resolve();
        order.push("initial:stored");
      },
      persistCancelled: async () => {
        order.push("cancel:start");
        await Promise.resolve();
        order.push("cancel:stored");
      },
      executeProvider: () => {
        order.push("provider");
      }
    });

    assert.equal(outcome, "cancelled");
    assert.deepEqual(order, [
      "initial:start",
      "initial:stored",
      "cancel:start",
      "cancel:stored"
    ]);
  });

  it("still claims cancellation after an initial persistence failure", async () => {
    const order: string[] = [];
    const failure = new Error("initial failed");

    await assert.rejects(
      executeAcceptedChatRun({
        preCancelled: true,
        persistInitial: () => {
          order.push("initial");
          throw failure;
        },
        persistCancelled: () => {
          order.push("cancel");
        },
        executeProvider: () => {
          order.push("provider");
        }
      }),
      failure
    );
    assert.deepEqual(order, ["initial", "cancel"]);
  });

  it("starts the provider only after ordinary initial persistence", async () => {
    const order: string[] = [];

    const outcome = await executeAcceptedChatRun({
      preCancelled: false,
      persistInitial: () => {
        order.push("initial");
      },
      persistCancelled: () => {
        order.push("cancel");
      },
      executeProvider: () => {
        order.push("provider");
      }
    });

    assert.equal(outcome, "provider-executed");
    assert.deepEqual(order, ["initial", "provider"]);
  });
});
