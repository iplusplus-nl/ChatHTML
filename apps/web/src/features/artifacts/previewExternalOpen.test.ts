import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openPreviewExternalUrl } from "./previewExternalOpen";

describe("preview external open", () => {
  it("treats a null noopener handle as a completed open", () => {
    const calls: string[][] = [];

    assert.doesNotThrow(() => {
      openPreviewExternalUrl("https://example.com/", (...args) => {
        calls.push(args);
        return null;
      });
    });

    assert.deepEqual(calls, [
      ["https://example.com/", "_blank", "noopener,noreferrer"]
    ]);
  });

  it("preserves errors thrown by the browser open call", () => {
    const failure = new Error("open failed");

    assert.throws(
      () =>
        openPreviewExternalUrl("https://example.com/", () => {
          throw failure;
        }),
      failure
    );
  });

  it("clears the opener when the browser returns a handle", () => {
    const opened = { opener: {} };

    openPreviewExternalUrl("https://example.com/", () => opened);

    assert.equal(opened.opener, null);
  });
});
