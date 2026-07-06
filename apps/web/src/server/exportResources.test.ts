import assert from "node:assert/strict";
import test from "node:test";
import {
  isExportableImageContentType,
  normalizeExportResourceUrl
} from "../../server/exportResources.js";

test("normalizes export resource urls", () => {
  assert.equal(
    normalizeExportResourceUrl(" https://example.com/image.png#preview "),
    "https://example.com/image.png"
  );
  assert.equal(
    normalizeExportResourceUrl(["http://127.0.0.1:8787/api/files/a/content"]),
    "http://127.0.0.1:8787/api/files/a/content"
  );
  assert.equal(normalizeExportResourceUrl("file:///tmp/image.png"), undefined);
  assert.equal(normalizeExportResourceUrl("data:image/png;base64,abc"), undefined);
});

test("allows image content types for export resources", () => {
  assert.equal(isExportableImageContentType("image/png"), true);
  assert.equal(isExportableImageContentType("image/svg+xml; charset=utf-8"), true);
  assert.equal(isExportableImageContentType("text/html"), false);
  assert.equal(isExportableImageContentType(null), false);
});
