import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeArtifactSelectionPayload } from "./previewSelectionPayload";

describe("preview selection payload", () => {
  it("rejects malformed selections", () => {
    assert.equal(normalizeArtifactSelectionPayload(null), null);
    assert.equal(normalizeArtifactSelectionPayload({}), null);
    assert.equal(
      normalizeArtifactSelectionPayload({ kind: "other", key: "a", selector: "b" }),
      null
    );
    assert.equal(
      normalizeArtifactSelectionPayload({ kind: "text", key: "", selector: "b" }),
      null
    );
  });

  it("normalizes text selections and supplies labels", () => {
    assert.deepEqual(
      normalizeArtifactSelectionPayload({
        kind: "text",
        key: "  selection-1 ",
        selector: " main   p:nth-child(2) ",
        text: "  selected\n text  "
      }),
      {
        kind: "text",
        key: "selection-1",
        selector: "main p:nth-child(2)",
        label: "Selected text",
        preview: "Selected text",
        text: "selected text"
      }
    );
  });

  it("caps every user-controlled selection field", () => {
    const result = normalizeArtifactSelectionPayload({
      kind: "element",
      key: "k".repeat(800),
      selector: "s".repeat(1400),
      label: "l".repeat(300),
      preview: "human readable ".repeat(100),
      tagName: "DIV".repeat(30),
      text: "t".repeat(2400),
      html: "h".repeat(13000)
    });

    assert.ok(result);
    assert.equal(result.key.length, 700);
    assert.equal(result.selector.length, 1200);
    assert.equal(result.label.length, 220);
    assert.equal(result.preview.length, 420);
    assert.equal(result.tagName?.length, 80);
    assert.equal(result.text?.length, 2200);
    assert.equal(result.html?.length, 12500);
  });

  it("does not retain optional blank fields", () => {
    assert.deepEqual(
      normalizeArtifactSelectionPayload({
        kind: "element",
        key: "key",
        selector: "#target",
        label: "Button",
        preview: "Opens details",
        tagName: " ",
        text: " ",
        html: ""
      }),
      {
        kind: "element",
        key: "key",
        selector: "#target",
        label: "Button",
        preview: "Opens details"
      }
    );
  });
});
