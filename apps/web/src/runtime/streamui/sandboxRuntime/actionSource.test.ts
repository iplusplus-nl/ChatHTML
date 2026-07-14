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

  it("settles prompt actions and restores their original control state", () => {
    assert.match(actionSource, /const pendingPromptActions = new Map\(\)/);
    assert.match(actionSource, /const capabilityId = createHostCapabilityId\(\)/);
    assert.match(actionSource, /markActionPending\(trigger, capabilityId\)/);
    assert.match(actionSource, /pendingPromptActions\.delete\(capabilityId\)/);
    assert.match(
      actionSource,
      /restoreAttribute\(pending\.element, "aria-busy", pending\.ariaBusy\)/
    );
    assert.match(
      actionSource,
      /restoreAttribute\(pending\.element, "aria-disabled", pending\.ariaDisabled\)/
    );
    assert.match(
      actionSource,
      /restoreAttribute\(pending\.element, "disabled", pending\.disabledAttribute\)/
    );
    assert.match(
      actionSource,
      /pending\.element\.replaceChildren\(\.\.\.pending\.childNodes\)/
    );
    assert.match(
      actionSource,
      /data\.kind !== "capability-result"/
    );
  });

  it("forwards Escape presses to the host", () => {
    assert.match(actionSource, /post\("escape", "escape"\)/);
  });
});
