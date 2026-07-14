import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARTIFACT_EDIT_SELECTION_LABEL,
  getElementReferenceSummary
} from "./chatMessageArtifactReferenceModel";

describe("artifact edit selection labels", () => {
  it("uses English labels and fallback text in the English UI", () => {
    assert.equal(ARTIFACT_EDIT_SELECTION_LABEL, "Selection");
    assert.equal(
      getElementReferenceSummary({
        kind: "element",
        key: "selected-element",
        selector: "[data-streamui-key='selected-element']",
        label: "",
        preview: ""
      }),
      "Element"
    );
  });
});
