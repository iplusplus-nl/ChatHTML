import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSharePageHtml } from "../../server/artifactShares.js";

test("artifact share page marks the feature experimental and embeds the document safely", () => {
  const html = createArtifactSharePageHtml({
    id: "share-example-123456",
    title: "Demo <Artifact>",
    createdAt: "2026-07-06T00:00:00.000Z",
    themeMode: "night",
    document: "<!doctype html><script>window.__ok = true;</script>",
    sourceMessageId: "message-1"
  });

  assert.match(html, /Experimental/);
  assert.match(html, /Demo &lt;Artifact&gt;/);
  assert.doesNotMatch(html, /<script>window\.__ok = true;<\/script>/);
  assert.match(html, /\\u003cscript>window\.__ok = true;\\u003c\/script>/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin/);
});
