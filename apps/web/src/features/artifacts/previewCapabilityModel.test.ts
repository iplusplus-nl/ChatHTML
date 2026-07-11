import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCapabilityConfirmLabel,
  getCapabilityPreview,
  getCapabilityTitle,
  normalizeCapabilityLabel,
  normalizeCapabilityText,
  normalizeOpenUrl,
  sanitizeDownloadFilename,
  sanitizeMimeType,
  type PreviewCapabilityAction
} from "./previewCapabilityModel";

describe("preview capability model", () => {
  it("caps artifact text and labels", () => {
    assert.equal(normalizeCapabilityText("x".repeat(1_000_010)).length, 1_000_000);
    assert.equal(normalizeCapabilityLabel(`  ${"x".repeat(210)}  `)?.length, 200);
    assert.equal(normalizeCapabilityLabel("   "), undefined);
  });

  it("sanitizes filenames and supplies transport defaults", () => {
    assert.equal(sanitizeDownloadFilename('../bad:<name>?.txt'), "..-bad-name-.txt");
    assert.equal(sanitizeDownloadFilename(""), "chathtml-export.txt");
    assert.equal(sanitizeMimeType(""), "text/plain;charset=utf-8");
    assert.equal(sanitizeMimeType(" text/csv "), "text/csv");
  });

  it("resolves relative http URLs from an injected base", () => {
    assert.equal(
      normalizeOpenUrl("../next?q=1", "https://example.test/path/page"),
      "https://example.test/next?q=1"
    );
  });

  it("rejects empty and non-http URLs", () => {
    assert.throws(
      () => normalizeOpenUrl("", "https://example.test/"),
      /No URL/
    );
    assert.throws(
      () => normalizeOpenUrl("javascript:alert(1)", "https://example.test/"),
      /Only http and https/
    );
    assert.throws(
      () => normalizeOpenUrl("data:text/plain,hello", "https://example.test/"),
      /Only http and https/
    );
  });

  it("maps action copy for the confirmation panel", () => {
    const cases: Array<[PreviewCapabilityAction, string, string, string]> = [
      [{ type: "copy", text: "copy me" }, "Copy from artifact", "Copy", "copy me"],
      [
        { type: "download", text: "csv", filename: "a.csv", mimeType: "text/csv" },
        "Download from artifact",
        "Download",
        "csv"
      ],
      [
        { type: "open-url", url: "https://example.test/" },
        "Open link from artifact",
        "Open",
        "https://example.test/"
      ]
    ];

    for (const [action, title, confirm, preview] of cases) {
      assert.equal(getCapabilityTitle(action), title);
      assert.equal(getCapabilityConfirmLabel(action), confirm);
      assert.equal(getCapabilityPreview(action), preview);
    }
  });
});
