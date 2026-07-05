import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamingRenderer } from "./streamingRenderer";

describe("createStreamingRenderer", () => {
  it("streams partial html into a completed iframe document", () => {
    const renderer = createStreamingRenderer("day");

    renderer.feed("<section><p>Hello");
    const snapshot = renderer.getSnapshot();

    assert.equal(snapshot.status, "streaming");
    assert.equal(snapshot.raw, "<section><p>Hello");
    assert.equal(snapshot.completedHtml, "<section><p>Hello</p></section>");
    assert.match(snapshot.iframeDocument, /data-page-theme="day"/);
    assert.match(snapshot.iframeDocument, /<section><p>Hello<\/p><\/section>/);
  });

  it("replaces raw content so stream chunks cannot leave stale preview state", () => {
    const renderer = createStreamingRenderer();

    renderer.replace("<p>First</p>");
    renderer.replace("<p>First</p><p>Second</p>");

    const snapshot = renderer.getSnapshot();
    assert.equal(snapshot.raw, "<p>First</p><p>Second</p>");
    assert.equal((snapshot.iframeDocument.match(/<p>/g) ?? []).length, 2);
  });

  it("allows scripts only after completion", () => {
    const renderer = createStreamingRenderer();
    const input = "<p>Hi</p><script>window.ok = true;</script>";

    renderer.replace(input);
    assert.doesNotMatch(renderer.getSnapshot().completedHtml, /<script>/);

    renderer.complete();
    assert.match(renderer.getSnapshot().completedHtml, /<script>/);
  });

  it("deduplicates security errors", () => {
    const renderer = createStreamingRenderer();
    const errors: string[] = [];

    renderer.onError((error) => errors.push(error.message));
    renderer.feed("<script>localStorage.getItem('x')</script>");
    renderer.feed("<script>localStorage.getItem('y')</script>");

    assert.deepEqual(errors, [
      "Browser storage APIs are not allowed in StreamUI artifacts."
    ]);
    assert.equal(renderer.getSnapshot().errors.length, 1);
  });

  it("allows bridged clipboard writes but blocks clipboard reads", () => {
    const writeRenderer = createStreamingRenderer();
    writeRenderer.feed("<script>navigator.clipboard.writeText('x')</script>");
    assert.equal(writeRenderer.getSnapshot().errors.length, 0);

    const readRenderer = createStreamingRenderer();
    readRenderer.feed("<script>navigator.clipboard.readText()</script>");
    assert.deepEqual(
      readRenderer.getSnapshot().errors.map((error) => error.message),
      ["Clipboard reads are not allowed in StreamUI artifacts."]
    );
  });

  it("notifies snapshot subscribers", () => {
    const renderer = createStreamingRenderer();
    const statuses: string[] = [];
    const unsubscribe = renderer.onSnapshot((snapshot) => {
      statuses.push(snapshot.status);
    });

    renderer.feed("<p>Hi</p>");
    renderer.complete();
    unsubscribe();
    renderer.reset();

    assert.deepEqual(statuses, ["idle", "streaming", "complete"]);
  });
});
