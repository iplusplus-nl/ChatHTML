import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PREVIEW_IFRAME_SANDBOX,
  createPreviewChannelToken,
  createPreviewHostRenderMessage
} from "./previewFrameSandbox";

describe("preview iframe sandbox", () => {
  it("runs artifact scripts without granting the application origin", () => {
    const tokens = new Set(PREVIEW_IFRAME_SANDBOX.split(/\s+/));

    assert.equal(tokens.has("allow-scripts"), true);
    assert.equal(tokens.has("allow-same-origin"), false);
    assert.equal(tokens.has("allow-popups-to-escape-sandbox"), false);
  });

  it("builds a disabled streaming patch for the isolated runtime", () => {
    const message = createPreviewHostRenderMessage(
      "<main>Hello</main>",
      "day",
      "document-token"
    );

    assert.equal(message.source, "streamui-host");
    assert.equal(message.documentEpoch, "document-token");
    assert.equal("channelToken" in message, false);
    assert.equal(message.kind, "render");
    assert.equal(message.actionsEnabled, false);
    assert.equal(message.theme.mode, "day");
    assert.match(message.bodyHtml, /<main>Hello<\/main>/);
    assert.match(message.bodyHtml, /streamui-performance-guard/);
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    const token = createPreviewChannelToken({
      getRandomValues(array) {
        if (array) {
          new Uint8Array(
            array.buffer,
            array.byteOffset,
            array.byteLength
          ).fill(0xab);
        }
        return array;
      }
    });

    assert.equal(token, "abababab-abab-4bab-abab-abababababab");
  });
});
