import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RenderSnapshot } from "../../runtime/streamui/types";
import { createStreamingRenderer } from "../../runtime/streamui/streamingRenderer";
import {
  createChatRunState,
  reduceChatRunState
} from "./chatRunStateMachine";
import {
  presentLocalChatRunTerminal,
  projectCompletedChatRun,
  projectFailedChatRun,
  projectStreamingChatRun
} from "./chatRunPresentation";

const baseInput = {
  raw: "Plain answer",
  reasoning: "Thinking",
  streamSequence: 7
};

describe("chat run presentation", () => {
  it("projects plain streaming text without visual-only fields", () => {
    const result = projectStreamingChatRun("Plain partial answer");

    assert.equal(result.streamUiSource, undefined);
    assert.deepEqual(result.patch, {
      content: "Plain partial answer",
      rawStream: "Plain partial answer",
      hasStreamUi: false,
      streamUiComplete: false,
      generationOutcome: undefined
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "snapshot"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "artifactContext"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "sessionTitle"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "streamSequence"),
      false
    );
  });

  it("projects partial StreamUI while suppressing protocol fallback text", () => {
    const raw = "<chat></chat><streamui><section>Loading";
    const result = projectStreamingChatRun(raw, 3);

    assert.equal(result.streamUiSource, "<section>Loading");
    assert.deepEqual(result.patch, {
      content: "",
      rawStream: raw,
      hasStreamUi: true,
      streamUiComplete: false,
      generationOutcome: undefined,
      streamSequence: 3
    });
  });

  it("adds completed title and artifact context only when available", () => {
    const raw =
      "<sessiontitle>Demo</sessiontitle><chat>Hello</chat><streamui><main>Hi</main></streamui>";
    const result = projectStreamingChatRun(raw, 4);

    assert.equal(result.streamUiSource, "<main>Hi</main>");
    assert.equal(result.patch.content, "Hello");
    assert.equal(result.patch.sessionTitle, "Demo");
    assert.equal(result.patch.artifactContext?.textSummary, "Hi");
    assert.equal(result.patch.hasStreamUi, true);
    assert.equal(result.patch.streamUiComplete, true);
    assert.equal(result.patch.streamSequence, 4);
  });

  it("preserves an empty StreamUI source so the renderer can be cleared", () => {
    const result = projectStreamingChatRun(
      "<chat>Text</chat><streamui></streamui>",
      0
    );

    assert.equal(result.streamUiSource, "");
    assert.equal(result.patch.hasStreamUi, true);
    assert.equal(result.patch.streamUiComplete, true);
    assert.equal(result.patch.streamSequence, 0);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "artifactContext"),
      false
    );
  });

  it("projects a text-only completion and explicitly clears visual fields", () => {
    const result = projectCompletedChatRun(baseInput);

    assert.equal(result.streamUiSource, undefined);
    assert.deepEqual(result.patch, {
      content: "Plain answer",
      reasoning: "Thinking",
      sessionTitle: undefined,
      rawStream: "Plain answer",
      streamSequence: 7,
      snapshot: undefined,
      artifactContext: undefined,
      hasStreamUi: false,
      streamUiComplete: false,
      generationOutcome: "complete",
      status: "complete"
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "snapshot"),
      true
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "artifactContext"),
      true
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.patch, "sessionTitle"),
      true
    );
  });

  it("projects title, chat, and visible StreamUI without mutating the input", () => {
    const input = {
      raw: "<sessiontitle>Demo</sessiontitle><chat>Hello</chat><streamui><main><h1>Hi</h1></main></streamui>",
      reasoning: "",
      streamSequence: 11
    };
    const original = { ...input };
    const result = projectCompletedChatRun(input);

    assert.equal(result.streamUiSource, "<main><h1>Hi</h1></main>");
    assert.equal(result.patch.content, "Hello");
    assert.equal(result.patch.sessionTitle, "Demo");
    assert.equal(result.patch.hasStreamUi, true);
    assert.equal(result.patch.streamUiComplete, true);
    assert.ok(result.patch.artifactContext);
    assert.equal(result.patch.artifactContext?.textSummary, "Hi");
    assert.deepEqual(input, original);
  });

  it("keeps a non-empty partial StreamUI renderable but rejects an empty one", () => {
    const partial = projectCompletedChatRun({
      ...baseInput,
      raw: "<chat>Partial</chat><streamui><section>Loading"
    });
    const empty = projectCompletedChatRun({
      ...baseInput,
      raw: "<chat>Text</chat><streamui>   </streamui>"
    });

    assert.equal(partial.streamUiSource, "<section>Loading");
    assert.equal(partial.patch.hasStreamUi, true);
    assert.equal(partial.patch.streamUiComplete, false);
    assert.ok(partial.patch.artifactContext);
    assert.equal(empty.streamUiSource, undefined);
    assert.equal(empty.patch.hasStreamUi, false);
    assert.equal(empty.patch.artifactContext, undefined);
    assert.equal(empty.patch.streamUiComplete, true);
  });

  it("allows the caller to attach only a renderer-completed snapshot", () => {
    const snapshot: RenderSnapshot = {
      raw: "<p>Hi</p>",
      completedHtml: "<p>Hi</p>",
      iframeDocument: "<!doctype html><p>Hi</p>",
      errors: [],
      status: "complete"
    };
    const result = projectCompletedChatRun({
      ...baseInput,
      raw: "<streamui><p>Hi</p></streamui>"
    });
    const patch = { ...result.patch, snapshot };

    assert.equal(result.patch.snapshot, undefined);
    assert.equal(patch.snapshot, snapshot);
    assert.equal(patch.snapshot.status, "complete");
  });

  it("projects a sanitized failure without clearing visual state", () => {
    const patch = projectFailedChatRun({
      raw: "<chat>Partial answer</chat><streamui><div>Work",
      reasoning: "Thinking",
      streamSequence: 5,
      error: '{"error":{"message":"Provider failed"}}'
    });

    assert.deepEqual(patch, {
      content: "Partial answer",
      reasoning: "Thinking",
      rawStream: "<chat>Partial answer</chat><streamui><div>Work",
      streamSequence: 5,
      generationOutcome: "error",
      error: "Provider failed",
      status: "error"
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, "snapshot"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, "artifactContext"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, "hasStreamUi"),
      false
    );
  });

  it("uses the standard failure fallback for an empty response", () => {
    assert.equal(
      projectFailedChatRun({
        raw: "",
        reasoning: "",
        streamSequence: 0,
        error: ""
      }).content,
      "I could not complete that request."
    );
  });

  it("presents an explicit stream completion even if transport later fails", () => {
    const streaming = createChatRunState({
      runId: "run-1",
      raw: "<chat>Done</chat><streamui><main>Artifact</main></streamui>",
      reasoning: "Thought",
      streamSequence: 4
    });
    const done = reduceChatRunState(streaming, {
      type: "done",
      status: "complete",
      error: "",
      sequence: 5
    }).state;
    const result = presentLocalChatRunTerminal(
      done,
      createStreamingRenderer("day")
    );

    assert.equal(result?.phase, "complete");
    assert.equal(result?.patch.content, "Done");
    assert.equal(result?.patch.status, "complete");
    assert.equal(result?.patch.streamSequence, 5);
    assert.equal(result?.patch.snapshot?.status, "complete");
    assert.equal(result?.patch.snapshot?.raw, "<main>Artifact</main>");
  });

  it("presents explicit stream errors and cancellation without a renderer snapshot", () => {
    const streaming = createChatRunState({
      runId: "run-1",
      raw: "<chat>Partial</chat>",
      streamSequence: 2
    });
    const failed = reduceChatRunState(streaming, {
      type: "done",
      status: "error",
      error: '{"error":"Provider failed"}',
      sequence: 3
    }).state;
    const cancelled = reduceChatRunState(streaming, { type: "cancel" }).state;
    const renderer = createStreamingRenderer();
    const failure = presentLocalChatRunTerminal(failed, renderer);
    const cancellation = presentLocalChatRunTerminal(cancelled, renderer);

    assert.equal(failure?.phase, "error");
    assert.equal(failure?.patch.error, "Provider failed");
    assert.equal(failure?.patch.content, "Partial");
    assert.equal(cancellation?.phase, "cancelled");
    assert.equal(cancellation?.patch.status, "complete");
    assert.equal(cancellation?.patch.error, undefined);
    assert.equal(renderer.getSnapshot().status, "idle");
  });

  it("leaves server terminals for their authoritative server patch", () => {
    const serverTerminal = reduceChatRunState(
      createChatRunState({ runId: "run-1" }),
      {
        type: "server",
        message: {
          id: "assistant-1",
          role: "assistant",
          content: "Done",
          generationRunId: "run-1",
          status: "complete"
        }
      }
    ).state;

    assert.equal(
      presentLocalChatRunTerminal(serverTerminal, createStreamingRenderer()),
      undefined
    );
  });
});
