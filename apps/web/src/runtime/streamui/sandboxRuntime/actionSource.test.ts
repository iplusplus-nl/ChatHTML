import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionSource } from "./actionSource";

describe("sandbox runtime action source", () => {
  it("rejects synthetic clicks before every host-facing click path", () => {
    const clickHandlers = actionSource
      .split('document.addEventListener("click", (event) => {')
      .slice(1);

    assert.equal(clickHandlers.length, 2);

    const trustedGuard = "if (!event.isTrusted)";
    const selectionLookup = "findSelectableElement(event.target)";
    const actionLookup = "findCapabilityAction(event.target)";

    assert.ok(clickHandlers[0].indexOf(trustedGuard) >= 0);
    assert.ok(
      clickHandlers[0].indexOf(trustedGuard) <
        clickHandlers[0].indexOf(selectionLookup)
    );
    assert.ok(clickHandlers[1].indexOf(trustedGuard) >= 0);
    assert.ok(
      clickHandlers[1].indexOf(trustedGuard) <
        clickHandlers[1].indexOf(actionLookup)
    );
  });
});
