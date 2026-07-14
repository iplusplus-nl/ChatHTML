import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPreviewFrameDocument,
  previewFrameDocumentMatches
} from "./previewFrameDocumentModel";

describe("preview frame document model", () => {
  it("mounts an already-complete artifact in its first document", () => {
    const document = createPreviewFrameDocument({
      epoch: 0,
      mode: "complete",
      completedHtml: "<main>Restored artifact</main>",
      themeMode: "night",
      channelToken: "complete-token",
      documentEpoch: "complete-epoch"
    });

    assert.equal(document.mode, "complete");
    assert.match(document.source, /<main>Restored artifact<\/main>/);
    assert.match(document.source, /data-streamui-actions-enabled="true"/);
    assert.match(document.source, /complete-token/);
    assert.match(document.source, /complete-epoch/);
    assert.equal(
      previewFrameDocumentMatches(
        document,
        "complete",
        "<main>Restored artifact</main>",
        "night"
      ),
      true
    );
  });

  it("keeps streaming bodies out of the initial document for inert patching", () => {
    const document = createPreviewFrameDocument({
      epoch: 4,
      mode: "streaming",
      completedHtml: "<main>Partial</main>",
      themeMode: "day",
      channelToken: "stream-token",
      documentEpoch: "stream-epoch"
    });

    assert.equal(document.completedHtml, "");
    assert.doesNotMatch(document.source, /<main>Partial<\/main>/);
    assert.match(document.source, /data-streamui-actions-enabled="false"/);
    assert.equal(
      previewFrameDocumentMatches(
        document,
        "streaming",
        "<main>New partial bytes</main>",
        "day"
      ),
      true
    );
  });

  it("requires a new document for completion and source changes, but not themes", () => {
    const document = createPreviewFrameDocument({
      epoch: 1,
      mode: "complete",
      completedHtml: "<main>One</main>",
      themeMode: "night",
      channelToken: "token",
      documentEpoch: "epoch"
    });

    assert.equal(
      previewFrameDocumentMatches(document, "streaming", "", "night"),
      false
    );
    assert.equal(
      previewFrameDocumentMatches(
        document,
        "complete",
        "<main>Two</main>",
        "night"
      ),
      false
    );
    assert.equal(
      previewFrameDocumentMatches(
        document,
        "complete",
        "<main>One</main>",
        "day"
      ),
      true
    );
  });

  it("rejects an outbound secret reused as the inbound document epoch", () => {
    assert.throws(
      () =>
        createPreviewFrameDocument({
          epoch: 0,
          mode: "complete",
          completedHtml: "<main>Unsafe</main>",
          themeMode: "night",
          channelToken: "reused-token",
          documentEpoch: "reused-token"
        }),
      /distinct document tokens/
    );
  });
});
