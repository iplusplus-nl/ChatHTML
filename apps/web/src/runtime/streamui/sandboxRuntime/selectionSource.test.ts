import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectionSource } from "./selectionSource";

describe("sandbox runtime selection source", () => {
  it("rejects synthetic text-selection toolbar clicks before posting", () => {
    const handler = selectionSource.split(
      'textSelectionToolbar.addEventListener("click", (event) => {'
    )[1];

    assert.ok(handler);
    assert.ok(handler.indexOf("if (!event.isTrusted)") >= 0);
    assert.ok(
      handler.indexOf("if (!event.isTrusted)") <
        handler.indexOf("postSelectionPayload(payload)")
    );
  });
});
