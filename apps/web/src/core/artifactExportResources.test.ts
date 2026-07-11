import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getExportResourceFetchUrl,
  inlineCssResourceUrls,
  resolveExportResourceUrl,
  shouldInlineExportResource
} from "./artifactExportResources";

describe("artifact export resources", () => {
  it("resolves relative resources against the snapshot base URL", () => {
    assert.equal(
      resolveExportResourceUrl("../image.png", "https://example.test/a/page"),
      "https://example.test/image.png"
    );
    assert.equal(resolveExportResourceUrl("#gradient", "https://example.test/"), undefined);
    assert.equal(resolveExportResourceUrl("http://[", "https://example.test/"), undefined);
  });

  it("inlines only fetchable external and blob protocols", () => {
    assert.equal(shouldInlineExportResource("https://example.test/a.png"), true);
    assert.equal(shouldInlineExportResource("http://example.test/a.png"), true);
    assert.equal(shouldInlineExportResource("blob:https://example.test/id"), true);
    assert.equal(shouldInlineExportResource("data:image/png;base64,AA=="), false);
    assert.equal(shouldInlineExportResource("file:///tmp/a.png"), false);
  });

  it("proxies remote resources and leaves blob URLs local", () => {
    assert.equal(
      getExportResourceFetchUrl("https://example.test/image.png?q=1"),
      "/api/export-resource?url=https%3A%2F%2Fexample.test%2Fimage.png%3Fq%3D1"
    );
    assert.equal(
      getExportResourceFetchUrl("blob:https://example.test/id"),
      "blob:https://example.test/id"
    );
  });

  it("leaves non-fetchable CSS resource references byte-identical", async () => {
    const css = ".icon{mask:url(#shape)} .inline{background:url(data:image/png;base64,AA==)}";
    assert.equal(await inlineCssResourceUrls(css, "https://example.test/", new Map()), css);
  });
});
