import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeArtifactEditReferences,
  normalizeArtifactEditRequest
} from "./artifactEditRequest.js";

function reference(
  key = "selection-1",
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    kind: "element",
    key,
    selector: "#hero",
    label: "Hero",
    preview: "Old hero",
    ...overrides
  };
}

describe("artifact edit request normalization", () => {
  it("validates source, prompt, and references independently", () => {
    const cases: Array<{
      body: unknown;
      status: 400 | 413;
      error: string;
    }> = [
      {
        body: { source: 42, prompt: "Change it", references: [reference()] },
        status: 400,
        error: "Artifact source is required."
      },
      {
        body: {
          source: "x".repeat(2_000_001),
          prompt: "Change it",
          references: [reference()]
        },
        status: 413,
        error: "Artifact source is too large to edit safely."
      },
      {
        body: { source: "<streamui>x</streamui>", prompt: {}, references: [reference()] },
        status: 400,
        error: "Edit prompt is required."
      },
      {
        body: {
          source: "<streamui>x</streamui>",
          prompt: "Change it",
          references: [{ kind: "element", key: "missing-selector" }]
        },
        status: 400,
        error: "At least one artifact reference is required."
      }
    ];

    for (const testCase of cases) {
      assert.deepEqual(normalizeArtifactEditRequest(testCase.body), {
        ok: false,
        status: testCase.status,
        error: testCase.error
      });
    }
  });

  it("preserves source bytes while trimming bounded prompt and reference fields", () => {
    const source = "  <streamui><div>Original</div></streamui>\n";
    const apiSettings = { model: "example/model" };
    const result = normalizeArtifactEditRequest({
      source,
      prompt: "  Change the hero  ",
      references: [
        reference(" selection-1 ", {
          selector: "  #hero  ",
          html: "  <div id=\"hero\">Original</div>  "
        })
      ],
      apiSettings
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.value.source, source);
    assert.equal(result.value.prompt, "Change the hero");
    assert.equal(result.value.references[0].key, "selection-1");
    assert.equal(result.value.references[0].selector, "#hero");
    assert.equal(
      result.value.references[0].html,
      "  <div id=\"hero\">Original</div>  "
    );
    assert.equal(result.value.apiSettings, apiSettings);
  });

  it("deduplicates references by normalized key and keeps the first valid one", () => {
    const references = normalizeArtifactEditReferences([
      reference(" repeated ", { label: "First" }),
      reference("repeated", { label: "Second", selector: "#other" }),
      reference("unique", { kind: "text", label: "Unique" }),
      { kind: "invalid", key: "ignored", selector: "#ignored" }
    ]);

    assert.deepEqual(
      references.map(({ key, label, selector }) => ({ key, label, selector })),
      [
        { key: "repeated", label: "First", selector: "#hero" },
        { key: "unique", label: "Unique", selector: "#hero" }
      ]
    );
  });

  it("caps accepted references at eight", () => {
    const references = normalizeArtifactEditReferences(
      Array.from({ length: 12 }, (_, index) => reference(`selection-${index}`))
    );

    assert.equal(references.length, 8);
    assert.equal(references.at(-1)?.key, "selection-7");
  });
});
