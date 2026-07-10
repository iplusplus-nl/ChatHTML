import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChatRunReconnectScheduler } from "./chatRunReconnectScheduler";

type PendingTimer = {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
};

function createFixture() {
  const timers: PendingTimer[] = [];
  const scheduler = createChatRunReconnectScheduler({
    initialDelayMs: 100,
    maxDelayMs: 400,
    setTimer(callback, delayMs) {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      (timer as PendingTimer).cleared = true;
    }
  });
  return { scheduler, timers };
}

describe("chat run reconnect scheduler", () => {
  it("backs off repeated reconnects and caps the delay", () => {
    const { scheduler, timers } = createFixture();
    let reconnects = 0;

    assert.deepEqual(scheduler.schedule("run-1", () => reconnects += 1), {
      scheduled: true,
      attempt: 1,
      delayMs: 100
    });
    timers[0].callback();
    assert.equal(reconnects, 1);
    assert.equal(scheduler.has("run-1"), false);

    scheduler.schedule("run-1", () => reconnects += 1);
    timers[1].callback();
    scheduler.schedule("run-1", () => reconnects += 1);
    timers[2].callback();
    const capped = scheduler.schedule("run-1", () => reconnects += 1);

    assert.equal(timers[1].delayMs, 200);
    assert.equal(timers[2].delayMs, 400);
    assert.deepEqual(capped, {
      scheduled: true,
      attempt: 4,
      delayMs: 400
    });
    assert.equal(reconnects, 3);
  });

  it("deduplicates a pending reconnect and resets after progress", () => {
    const { scheduler, timers } = createFixture();
    const first = scheduler.schedule("run-1", () => undefined);
    const duplicate = scheduler.schedule("run-1", () => undefined);

    assert.equal(first.scheduled, true);
    assert.deepEqual(duplicate, {
      scheduled: false,
      attempt: 1,
      delayMs: 100
    });
    assert.equal(timers.length, 1);

    scheduler.markProgress("run-1");
    assert.equal(timers[0].cleared, true);
    assert.equal(scheduler.has("run-1"), false);
    assert.deepEqual(scheduler.schedule("run-1", () => undefined), {
      scheduled: true,
      attempt: 1,
      delayMs: 100
    });
  });

  it("does not let a stale timer fire after cancel and reschedule", () => {
    const { scheduler, timers } = createFixture();
    const calls: string[] = [];
    scheduler.schedule("run-1", () => calls.push("old"));
    const oldTimer = timers[0];

    scheduler.cancel("run-1");
    scheduler.schedule("run-1", () => calls.push("new"));
    oldTimer.callback();
    timers[1].callback();

    assert.deepEqual(calls, ["new"]);
  });

  it("clears timers on dispose and can activate for a new lifecycle", () => {
    const { scheduler, timers } = createFixture();
    scheduler.schedule("run-1", () => undefined);
    scheduler.schedule("run-2", () => undefined);

    scheduler.dispose();
    scheduler.dispose();

    assert.equal(timers.every((timer) => timer.cleared), true);
    assert.equal(scheduler.has("run-1"), false);
    assert.deepEqual(scheduler.schedule("run-3", () => undefined), {
      scheduled: false,
      attempt: 0,
      delayMs: 0
    });
    scheduler.activate();
    assert.deepEqual(scheduler.schedule("run-3", () => undefined), {
      scheduled: true,
      attempt: 1,
      delayMs: 100
    });
  });
});
