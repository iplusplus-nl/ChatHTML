import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyArtifactSourceEdits,
  extractArtifactSourceEditJsonText,
  normalizeArtifactSourceEdits,
  parseArtifactSourceEditModelText,
  recoverArtifactSourceEditsFromModelText
} from "./artifactSourceEdits.js";

describe("artifact source edit model output", () => {
  it("extracts and parses a JSON object from fenced model prose", () => {
    const raw = `Here is the patch:
\`\`\`json
{"summary":"Update","edits":[{"find":"Old","replace":"New"}]}
\`\`\`
Done.`;

    assert.equal(
      extractArtifactSourceEditJsonText(raw),
      '{"summary":"Update","edits":[{"find":"Old","replace":"New"}]}'
    );
    assert.deepEqual(parseArtifactSourceEditModelText(raw), {
      summary: "Update",
      edits: [{ find: "Old", replace: "New" }]
    });
  });

  it("returns an empty object for malformed JSON", () => {
    assert.deepEqual(parseArtifactSourceEditModelText("{not-json}"), {});
  });

  it("normalizes valid edits and ignores invalid model items", () => {
    const edits = normalizeArtifactSourceEdits({
      edits: [
        null,
        "not-an-edit",
        { find: 42, replace: "New" },
        { find: "Old", replace: 42 },
        { target: "other", replace: "New" },
        {
          find: "Old",
          replace: "New",
          occurrence: 1.6,
          note: "  rename  "
        }
      ]
    });

    assert.deepEqual(edits, [
      {
        find: "Old",
        replace: "New",
        occurrence: 2,
        note: "rename"
      }
    ]);
  });

  it("accepts a single edit object returned without an edits array", () => {
    assert.deepEqual(normalizeArtifactSourceEdits({ find: "Old", replace: "New" }), [
      {
        find: "Old",
        replace: "New",
        occurrence: undefined,
        note: undefined
      }
    ]);
  });

  it("recovers a complete streamui block from non-JSON output", () => {
    const recovered = recoverArtifactSourceEditsFromModelText(
      "I updated it below.\n<streamui data-theme=\"dark\"><main>New</main></streamui>\nDone.",
      {}
    );

    assert.equal(recovered.recovery, "raw_streamui");
    assert.deepEqual(recovered.edits, [
      {
        target: "streamui",
        replace: '<streamui data-theme="dark"><main>New</main></streamui>',
        note: "Recovered complete streamui replacement from model output."
      }
    ]);
  });

  it("does not invent an edit from invalid output", () => {
    assert.deepEqual(
      recoverArtifactSourceEditsFromModelText("The response was invalid.", {
        edits: [{ find: "Old" }]
      }),
      { edits: [], recovery: "none" }
    );
  });
});

describe("artifact source edit application", () => {
  it("applies the requested one-based occurrence", () => {
    const result = applyArtifactSourceEdits(
      "<streamui><p>a</p><p>a</p><p>a</p></streamui>",
      [{ find: "<p>a</p>", replace: "<p>b</p>", occurrence: 2 }]
    );

    assert.equal(
      result.rawStream,
      "<streamui><p>a</p><p>b</p><p>a</p></streamui>"
    );
    assert.equal(result.applied[0].occurrence, 2);
  });

  it("falls back to the only match for an over-specified occurrence", () => {
    const result = applyArtifactSourceEdits(
      "<streamui><button>Start</button></streamui>",
      [{ find: "<button>Start</button>", replace: "<button>Go</button>", occurrence: 3 }]
    );

    assert.equal(result.rawStream, "<streamui><button>Go</button></streamui>");
    assert.equal(result.applied[0].occurrence, 1);
  });

  it("rejects an ambiguous edit without an occurrence", () => {
    assert.throws(
      () =>
        applyArtifactSourceEdits("<streamui><p>a</p><p>a</p></streamui>", [
          { find: "<p>a</p>", replace: "<p>b</p>" }
        ]),
      /matched 2 places/
    );
  });

  it("rejects an occurrence beyond multiple available matches", () => {
    assert.throws(
      () =>
        applyArtifactSourceEdits("<streamui><p>a</p><p>a</p></streamui>", [
          { find: "<p>a</p>", replace: "<p>b</p>", occurrence: 3 }
        ]),
      /requested occurrence 3, but only 2 matched/
    );
  });

  it("replaces the entire streamui block without changing protocol text around it", () => {
    const source =
      "<chat><assistant>Keep this</assistant></chat><streamui><main>Old</main></streamui>tail";
    const replacement = "<streamui><main>New</main><footer>Added</footer></streamui>";
    const result = applyArtifactSourceEdits(source, [
      { target: "streamui", replace: replacement }
    ]);

    assert.equal(
      result.rawStream,
      `<chat><assistant>Keep this</assistant></chat>${replacement}tail`
    );
    assert.equal(
      result.applied[0].findLength,
      "<streamui><main>Old</main></streamui>".length
    );
  });

  it("rejects an invalid whole-block replacement", () => {
    assert.throws(
      () =>
        applyArtifactSourceEdits("<streamui><main>Old</main></streamui>", [
          { target: "streamui", replace: "<main>New</main>" }
        ]),
      /must include a streamui artifact block/
    );
  });

  it("rejects edits that unbalance or duplicate protocol blocks", () => {
    const source =
      "<chat><assistant>Keep</assistant></chat><streamui><main>Old</main></streamui>";

    assert.throws(
      () =>
        applyArtifactSourceEdits(source, [
          { find: "</streamui>", replace: "" }
        ]),
      /streamui protocol block structure/
    );
    assert.throws(
      () =>
        applyArtifactSourceEdits(source, [
          {
            find: "<main>Old</main>",
            replace:
              "<main>New</main><streamui><p>Duplicate</p></streamui>"
          }
        ]),
      /streamui protocol block structure/
    );
    assert.throws(
      () =>
        applyArtifactSourceEdits(source, [
          { find: "</chat>", replace: "" }
        ]),
      /chat protocol block structure/
    );
  });

  it("rejects a whole-block replacement containing nested protocol blocks", () => {
    assert.throws(
      () =>
        applyArtifactSourceEdits("<streamui><main>Old</main></streamui>", [
          {
            target: "streamui",
            replace:
              "<streamui><main>New</main><streamui>Nested</streamui></streamui>"
          }
        ]),
      /streamui protocol block structure/
    );
  });

  it("rejects empty and no-op edit sets", () => {
    assert.throws(
      () => applyArtifactSourceEdits("<streamui />", []),
      /did not return any source edits/
    );
    assert.throws(
      () =>
        applyArtifactSourceEdits("<streamui><p>Same</p></streamui>", [
          { find: "Same", replace: "Same" }
        ]),
      /does not change the source/
    );
  });
});
