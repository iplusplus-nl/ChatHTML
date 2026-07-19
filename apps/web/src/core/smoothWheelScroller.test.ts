import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSmoothWheelScroller } from "./smoothWheelScroller";

function createScheduler() {
  let nextFrameId = 1;
  let timestamp = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    scheduler: {
      requestFrame(callback: FrameRequestCallback) {
        const frameId = nextFrameId++;
        callbacks.set(frameId, callback);
        return frameId;
      },
      cancelFrame(frameId: number) {
        callbacks.delete(frameId);
      }
    },
    runFrame() {
      timestamp += 16;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(timestamp));
    },
    runUntilSettled() {
      for (let index = 0; callbacks.size > 0 && index < 100; index += 1) {
        this.runFrame();
      }
      assert.equal(callbacks.size, 0);
    },
    get pendingFrames() {
      return callbacks.size;
    }
  };
}

describe("smoothWheelScroller", () => {
  it("animates accumulated wheel deltas to their exact destination", () => {
    const frames = createScheduler();
    const scroller = createSmoothWheelScroller(frames.scheduler);
    const target = { clientHeight: 200, scrollHeight: 1_000, scrollTop: 100 };

    scroller.scrollBy(target, 120);
    assert.equal(target.scrollTop, 100);
    frames.runFrame();
    assert.ok(target.scrollTop > 100 && target.scrollTop < 220);

    scroller.scrollBy(target, 80);
    frames.runUntilSettled();
    assert.equal(target.scrollTop, 300);
  });

  it("clamps at scroll boundaries and cancels pending animation", () => {
    const frames = createScheduler();
    const scroller = createSmoothWheelScroller(frames.scheduler);
    const target = { clientHeight: 200, scrollHeight: 1_000, scrollTop: 760 };

    scroller.scrollBy(target, 200);
    frames.runUntilSettled();
    assert.equal(target.scrollTop, 800);

    scroller.scrollBy(target, -100);
    frames.runFrame();
    const positionWhenCancelled = target.scrollTop;
    scroller.cancel();
    assert.equal(frames.pendingFrames, 0);
    frames.runFrame();
    assert.equal(target.scrollTop, positionWhenCancelled);
  });

  it("settles when the browser quantizes scrollTop to coarse pixels", () => {
    const frames = createScheduler();
    const scroller = createSmoothWheelScroller(frames.scheduler);
    let scrollTop = 100;
    const target = {
      clientHeight: 200,
      scrollHeight: 1_000,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = Math.round(value / 2) * 2;
      }
    };

    scroller.scrollBy(target, 61);
    frames.runUntilSettled();
    assert.ok(Math.abs(target.scrollTop - 161) <= 1);
  });
});
