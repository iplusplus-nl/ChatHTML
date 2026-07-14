import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getFocusWrapTarget } from "./useModalFocusTrap";

describe("modal focus trap", () => {
  const first = { id: "first" };
  const middle = { id: "middle" };
  const last = { id: "last" };
  const focusable = [first, middle, last];

  it("wraps forward Tab from the final control to the first", () => {
    assert.equal(getFocusWrapTarget(focusable, last, false), first);
    assert.equal(getFocusWrapTarget(focusable, middle, false), undefined);
  });

  it("wraps Shift+Tab from the first control to the final control", () => {
    assert.equal(getFocusWrapTarget(focusable, first, true), last);
    assert.equal(getFocusWrapTarget(focusable, middle, true), undefined);
  });

  it("moves an outside focus target into the dialog", () => {
    assert.equal(getFocusWrapTarget(focusable, null, false), first);
    assert.equal(getFocusWrapTarget(focusable, null, true), last);
    assert.equal(getFocusWrapTarget([], null, false), undefined);
  });
});
