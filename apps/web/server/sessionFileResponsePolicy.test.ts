import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSessionFileResponsePolicy,
  normalizeSessionFileResponseMimeType
} from "./sessionFileResponsePolicy.js";

describe("session file response policy", () => {
  it("allows only stored raster images to render inline cross-origin", () => {
    assert.deepEqual(getSessionFileResponsePolicy("image", "image/png"), {
      contentType: "image/png",
      disposition: "inline",
      allowCrossOriginRead: true,
      crossOriginResourcePolicy: "cross-origin"
    });
    assert.equal(
      getSessionFileResponsePolicy("image", "IMAGE/WEBP; ignored=value")
        .disposition,
      "inline"
    );
  });

  it("forces active, unknown, and forged image metadata to download", () => {
    for (const [kind, mimeType] of [
      ["artifact", "text/html"],
      ["text", "application/xhtml+xml"],
      ["image", "image/svg+xml"],
      ["image", "text/html"],
      ["artifact", "image/png"]
    ] as const) {
      const policy = getSessionFileResponsePolicy(kind, mimeType);
      assert.equal(policy.contentType, "application/octet-stream");
      assert.equal(policy.disposition, "attachment");
      assert.equal(policy.allowCrossOriginRead, false);
      assert.equal(policy.crossOriginResourcePolicy, "same-origin");
    }
  });

  it("normalizes response types without accepting header syntax", () => {
    assert.equal(
      normalizeSessionFileResponseMimeType(" Text/Plain; charset=utf-8 "),
      "text/plain"
    );
    assert.equal(
      normalizeSessionFileResponseMimeType("text/html\r\nx-extra: injected"),
      "application/octet-stream"
    );
    assert.equal(
      normalizeSessionFileResponseMimeType(undefined),
      "application/octet-stream"
    );
  });
});
