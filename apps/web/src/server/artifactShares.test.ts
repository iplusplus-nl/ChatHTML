import assert from "node:assert/strict";
import test from "node:test";
import {
  createArtifactSharePageHtml,
  reuseArtifactShareRecord
} from "../../server/artifactShares.js";

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

test("artifact share reuse preserves the original link id", () => {
  const existing = {
    id: "share-existing-123456",
    title: "Old artifact",
    createdAt: "2026-07-06T00:00:00.000Z",
    themeMode: "night" as const,
    document: "<!doctype html>old",
    sourceMessageId: "message-1"
  };
  const next = {
    id: "share-new-123456",
    title: "Updated artifact",
    createdAt: "2026-07-06T00:01:00.000Z",
    themeMode: "day" as const,
    document: "<!doctype html>new",
    sourceMessageId: "message-1"
  };

  const reused = reuseArtifactShareRecord(next, existing);

  assert.equal(reused.id, existing.id);
  assert.equal(reused.createdAt, existing.createdAt);
  assert.equal(reused.updatedAt, next.createdAt);
  assert.equal(reused.title, next.title);
  assert.equal(reused.document, next.document);
  assert.equal(reused.themeMode, next.themeMode);
});
