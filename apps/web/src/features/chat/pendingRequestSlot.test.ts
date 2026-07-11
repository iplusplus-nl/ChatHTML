import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPendingRequestSlot } from "./pendingRequestSlot";

describe("pending request slot", () => {
  it("stores the latest pending request", () => {
    const slot = createPendingRequestSlot<{ id: string }>();
    const first = { id: "first" };
    const second = { id: "second" };

    slot.put(first);
    assert.equal(slot.peek(), first);
    slot.put(second);
    assert.equal(slot.peek(), second);
  });

  it("takes a request exactly once", () => {
    const slot = createPendingRequestSlot<string>();
    slot.put("resume once");

    assert.equal(slot.take(), "resume once");
    assert.equal(slot.take(), null);
    assert.equal(slot.peek(), null);
  });

  it("clears pending continuations without returning them", () => {
    const slot = createPendingRequestSlot<string>();
    slot.put("discard me");
    slot.clear();

    assert.equal(slot.peek(), null);
    assert.equal(slot.take(), null);
  });
});
