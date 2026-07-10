import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamingRenderer } from "../../runtime/streamui/streamingRenderer";
import type { RenderSnapshot } from "../../runtime/streamui/types";
import { subscribeRestoredChatRunRenderer } from "./chatRunRendererLifecycle";

describe("restored chat run renderer lifecycle", () => {
  it("does not replace a persisted visual snapshot with an initial idle snapshot", () => {
    const renderer = createStreamingRenderer();
    const snapshots: RenderSnapshot[] = [];
    const unsubscribe = subscribeRestoredChatRunRenderer({
      renderer,
      rawStream: "Plain streamed text",
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });

    assert.deepEqual([...snapshots], []);

    renderer.replace("<main>New artifact</main>");
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].raw, "<main>New artifact</main>");
    assert.equal(snapshots[0].status, "streaming");

    unsubscribe();
    renderer.replace("<main>Ignored</main>");
    assert.equal(snapshots.length, 1);
  });

  it("rebuilds the current partial StreamUI before publishing the first snapshot", () => {
    const renderer = createStreamingRenderer("day");
    const snapshots: RenderSnapshot[] = [];
    const raw = "<chat>Loading</chat><streamui><section>Partial";

    subscribeRestoredChatRunRenderer({
      renderer,
      rawStream: raw,
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].raw, "<section>Partial");
    assert.equal(snapshots[0].status, "streaming");
    assert.match(snapshots[0].iframeDocument, /data-page-theme="day"/);
  });

  it("publishes an explicit empty StreamUI so a stale preview is cleared", () => {
    const renderer = createStreamingRenderer();
    const snapshots: RenderSnapshot[] = [];

    subscribeRestoredChatRunRenderer({
      renderer,
      rawStream: "<chat>Text</chat><streamui></streamui>",
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].raw, "");
    assert.equal(snapshots[0].status, "idle");
  });
});
