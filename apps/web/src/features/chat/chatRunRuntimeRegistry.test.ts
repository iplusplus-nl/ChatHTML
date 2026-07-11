import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createChatRunRuntimeRegistry,
  type ChatRunRuntimeIdentity
} from "./chatRunRuntimeRegistry";

const identity: ChatRunRuntimeIdentity = {
  runId: "run-1",
  sessionId: "session-1",
  assistantId: "assistant-1"
};

async function isSettled<T>(promise: Promise<T>): Promise<boolean> {
  const pending = Symbol("pending");
  return (
    (await Promise.race([
      promise,
      Promise.resolve(pending)
    ])) !== pending
  );
}

describe("chat run runtime registry", () => {
  it("keeps a fresh run pending until the server accepts it", async () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const registration = registry.registerFresh(identity);
    const accepted = registration.waitUntilAccepted();

    assert.equal(registration.isAccepted(), false);
    assert.equal(await isSettled(accepted), false);
    assert.equal(registration.markAccepted(), true);
    assert.equal(await accepted, true);
    assert.equal(registration.isAccepted(), true);
  });

  it("settles an unaccepted fresh run as false when setup ends", async () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const registration = registry.registerFresh(identity);
    const accepted = registration.waitUntilAccepted();

    assert.equal(registration.end(), true);
    assert.equal(await accepted, false);
    assert.equal(registration.isAccepted(), false);
    assert.equal(registry.get(identity), undefined);
    assert.equal(registration.markAccepted(), false);
    assert.equal(registration.end(), false);
  });

  it("registers restored and explicitly pre-accepted fresh runs as accepted", async () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const restoredIdentity = { ...identity, runId: "restored" };
    const freshIdentity = { ...identity, runId: "fresh-accepted" };

    const restored = registry.registerRestored(restoredIdentity);
    const fresh = registry.registerFresh(freshIdentity, {
      initiallyAccepted: true
    });

    assert.equal(restored.isAccepted(), true);
    assert.equal(await restored.waitUntilAccepted(), true);
    assert.equal(fresh.isAccepted(), true);
    assert.equal(await fresh.waitUntilAccepted(), true);
  });

  it("waits across the accepted-to-execution setup gap", async () => {
    const registry = createChatRunRuntimeRegistry<{ name: string }>();
    const registration = registry.registerRestored(identity);
    const runtime = registry.get(identity);
    assert.ok(runtime);
    const executionPromise = runtime.waitUntilExecution();

    assert.equal(runtime.getExecution(), undefined);
    assert.equal(await isSettled(executionPromise), false);

    const execution = { name: "execution" };
    const detach = registration.attachExecution(execution);
    assert.ok(detach);

    assert.equal(await executionPromise, execution);
    assert.equal(runtime.getExecution(), execution);
    assert.equal(registry.getExecution(identity), execution);
    assert.equal(detach(), true);
    assert.equal(registry.getExecution(identity), undefined);
    assert.equal(detach(), false);
  });

  it("resolves setup waiters without an execution when registration ends", async () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const registration = registry.registerRestored(identity);
    const execution = registration.waitUntilExecution();

    registration.end();

    assert.equal(await execution, undefined);
  });

  it("matches the complete identity rather than run id alone", () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const firstExecution = { name: "first" };
    const secondExecution = { name: "second" };
    const first = registry.registerRestored(identity);
    const secondIdentity = {
      ...identity,
      sessionId: "session-2",
      assistantId: "assistant-2"
    };
    const second = registry.registerRestored(secondIdentity);

    first.attachExecution(firstExecution);
    second.attachExecution(secondExecution);

    assert.equal(registry.getExecution(identity), firstExecution);
    assert.equal(registry.getExecution(secondIdentity), secondExecution);
    assert.equal(
      registry.getExecution({ ...identity, assistantId: "assistant-2" }),
      undefined
    );
  });

  it("does not let an old attachment cleanup delete a newer instance", () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const registration = registry.registerRestored(identity);
    const firstExecution = { name: "first" };
    const secondExecution = { name: "second" };
    const detachFirst = registration.attachExecution(firstExecution);
    const detachSecond = registration.attachExecution(secondExecution);
    assert.ok(detachFirst);
    assert.ok(detachSecond);

    assert.equal(detachFirst(), false);
    assert.equal(registry.getExecution(identity), secondExecution);
    assert.equal(detachSecond(), true);
    assert.equal(registry.getExecution(identity), undefined);
  });

  it("also guards cleanup when the same execution object is reattached", () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const registration = registry.registerRestored(identity);
    const execution = {};
    const oldDetach = registration.attachExecution(execution);
    const currentDetach = registration.attachExecution(execution);
    assert.ok(oldDetach);
    assert.ok(currentDetach);

    assert.equal(oldDetach(), false);
    assert.equal(registry.getExecution(identity), execution);
    assert.equal(currentDetach(), true);
  });

  it("retires pending waits and isolates a replacement from its old handle", async () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const oldRegistration = registry.registerFresh(identity);
    const oldRuntime = registry.get(identity);
    assert.ok(oldRuntime);
    const oldAccepted = oldRuntime.waitUntilAccepted();
    const oldExecution = oldRuntime.waitUntilExecution();

    const replacement = registry.registerRestored(identity);
    const replacementExecution = { replacement: true };
    const detachReplacement = replacement.attachExecution(replacementExecution);
    assert.ok(detachReplacement);

    assert.equal(await oldAccepted, false);
    assert.equal(await oldExecution, undefined);
    assert.equal(oldRuntime.getExecution(), undefined);
    assert.equal(oldRegistration.markAccepted(), false);
    assert.equal(oldRegistration.attachExecution({ stale: true }), undefined);
    assert.equal(oldRegistration.end(), false);
    assert.equal(registry.getExecution(identity), replacementExecution);
    assert.equal(await replacement.waitUntilAccepted(), true);
  });

  it("does not let an old finally or detach remove a new registration", () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const oldRegistration = registry.registerRestored(identity);
    const oldDetach = oldRegistration.attachExecution({ old: true });
    assert.ok(oldDetach);

    const replacement = registry.registerRestored(identity);
    const replacementExecution = { replacement: true };
    replacement.attachExecution(replacementExecution);

    assert.equal(oldDetach(), false);
    assert.equal(oldRegistration.end(), false);
    assert.equal(registry.getExecution(identity), replacementExecution);
    assert.equal(registry.get(identity)?.identity.runId, identity.runId);
  });

  it("snapshots identity so caller mutation cannot corrupt its key", () => {
    const registry = createChatRunRuntimeRegistry<object>();
    const mutableIdentity = { ...identity };
    const registration = registry.registerRestored(mutableIdentity);
    const execution = {};
    registration.attachExecution(execution);

    mutableIdentity.runId = "mutated";

    assert.equal(registration.identity.runId, identity.runId);
    assert.equal(registry.getExecution(identity), execution);
    assert.equal(registry.getExecution(mutableIdentity), undefined);
  });
});
