import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPreviewHeightMeasurement,
  settlePendingPreviewHeight
} from "./previewHeightModel";

describe("preview height model", () => {
  it("clamps measurements and ignores epsilon-only changes", () => {
    assert.deepEqual(applyPreviewHeightMeasurement(36, null, 1, 0), {
      height: 36,
      pending: null,
      scheduleStartedAt: null
    });
    assert.deepEqual(applyPreviewHeightMeasurement(100, null, 105.2, 0), {
      height: 100,
      pending: null,
      scheduleStartedAt: null
    });
  });

  it("applies growth and small shrink immediately", () => {
    assert.equal(applyPreviewHeightMeasurement(100, null, 107, 0).height, 107);
    assert.equal(applyPreviewHeightMeasurement(100, null, 89, 0).height, 89);
  });

  it("holds a large shrink until the same target settles", () => {
    const first = applyPreviewHeightMeasurement(200, null, 100, 10);
    assert.deepEqual(first, {
      height: 200,
      pending: { height: 100, startedAt: 10 },
      scheduleStartedAt: 10
    });

    const repeated = applyPreviewHeightMeasurement(200, first.pending, 102, 500);
    assert.equal(repeated.height, 200);
    assert.equal(repeated.pending, first.pending);
    assert.equal(repeated.scheduleStartedAt, 10);

    const settled = applyPreviewHeightMeasurement(200, first.pending, 102, 710);
    assert.deepEqual(settled, {
      height: 102,
      pending: null,
      scheduleStartedAt: null
    });
  });

  it("restarts settlement when the shrink target materially changes", () => {
    const pending = { height: 100, startedAt: 10 };
    assert.deepEqual(applyPreviewHeightMeasurement(200, pending, 80, 400), {
      height: 200,
      pending: { height: 80, startedAt: 400 },
      scheduleStartedAt: 400
    });
  });

  it("cancels a pending shrink when a growth or small shrink arrives", () => {
    const pending = { height: 50, startedAt: 10 };
    assert.deepEqual(applyPreviewHeightMeasurement(100, pending, 110, 20), {
      height: 110,
      pending: null,
      scheduleStartedAt: null
    });
    assert.deepEqual(applyPreviewHeightMeasurement(100, pending, 94, 20), {
      height: 100,
      pending: null,
      scheduleStartedAt: null
    });
  });

  it("settles a pending target from the timer and reschedules early timers", () => {
    const pending = { height: 70, startedAt: 100 };
    assert.deepEqual(settlePendingPreviewHeight(200, pending, 799), {
      height: 200,
      pending,
      scheduleStartedAt: 100
    });
    assert.deepEqual(settlePendingPreviewHeight(200, pending, 800), {
      height: 70,
      pending: null,
      scheduleStartedAt: null
    });
    assert.deepEqual(settlePendingPreviewHeight(200, null, 800), {
      height: 200,
      pending: null,
      scheduleStartedAt: null
    });
  });
});
