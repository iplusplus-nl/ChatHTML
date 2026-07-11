import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createChatStreamLineHandler,
  parseChatStreamLine,
  type SequencedMemoryStreamEvent
} from "./chatStreamEvents";

describe("chat stream events", () => {
  it("parses content, reasoning, memory, done, and legacy text", () => {
    assert.deepEqual(
      parseChatStreamLine(
        JSON.stringify({ type: "content", text: "hello", runId: "run-1", seq: 1.4 })
      ),
      {
        kind: "content",
        text: "hello",
        runId: "run-1",
        sequence: 1
      }
    );
    assert.deepEqual(
      parseChatStreamLine(JSON.stringify({ type: "reasoning", text: "think", seq: 2 })),
      { kind: "reasoning", text: "think", runId: undefined, sequence: 2 }
    );

    const memory = parseChatStreamLine(
      JSON.stringify({ type: "memory", action: "delete", id: "memory-1", seq: 3 })
    );
    assert.equal(memory?.kind, "memory");
    assert.equal(memory?.sequence, 3);

    assert.deepEqual(
      parseChatStreamLine(
        JSON.stringify({ type: "done", status: "error", error: "Provider failed", seq: 4 })
      ),
      {
        kind: "done",
        status: "error",
        error: "Provider failed",
        runId: undefined,
        sequence: 4
      }
    );
    assert.deepEqual(parseChatStreamLine("legacy chunk"), {
      kind: "content",
      text: "legacy chunk"
    });
    assert.equal(parseChatStreamLine("  "), null);
    assert.equal(parseChatStreamLine(JSON.stringify({ type: "unknown", seq: 5 })), null);
  });

  it("keeps explicit and legacy cancelled done events distinct from completion", () => {
    assert.deepEqual(
      parseChatStreamLine(
        JSON.stringify({ type: "done", status: "cancelled", seq: 7 })
      ),
      {
        kind: "done",
        status: "cancelled",
        error: "",
        runId: undefined,
        sequence: 7
      }
    );
    assert.deepEqual(
      parseChatStreamLine(
        JSON.stringify({
          type: "done",
          status: "error",
          error: "Generation stopped.",
          seq: 8
        })
      ),
      {
        kind: "done",
        status: "cancelled",
        error: "Generation stopped.",
        runId: undefined,
        sequence: 8
      }
    );
  });

  it("ignores duplicate, out-of-order, and foreign-run events", () => {
    let lastSequence = 5;
    const effects: string[] = [];
    const handler = createChatStreamLineHandler({
      runId: "run-1",
      getLastSequence: () => lastSequence,
      onSequence: (sequence) => {
        lastSequence = sequence;
      },
      onContent: (text) => effects.push(`content:${text}`),
      onReasoning: (text) => effects.push(`reasoning:${text}`),
      onMemory: (event) =>
        effects.push(
          `memory:${event.action === "delete" ? event.id : event.item?.id ?? ""}`
        ),
      onDone: (status) => effects.push(`done:${status}`)
    });

    handler(JSON.stringify({ type: "content", text: "duplicate", runId: "run-1", seq: 5 }));
    handler(JSON.stringify({ type: "reasoning", text: "older", runId: "run-1", seq: 4 }));
    handler(JSON.stringify({ type: "content", text: "foreign", runId: "run-2", seq: 6 }));
    handler(JSON.stringify({ type: "content", text: "accepted", runId: "run-1", seq: 6 }));
    handler(JSON.stringify({ type: "memory", action: "delete", id: "memory-1", runId: "run-1", seq: 7 }));
    handler(JSON.stringify({ type: "done", status: "complete", runId: "run-1", seq: 8 }));

    assert.equal(lastSequence, 8);
    assert.deepEqual(effects, [
      "content:accepted",
      "memory:memory-1",
      "done:complete"
    ]);
  });

  it("dispatches sequence-free legacy lines without changing the cursor", () => {
    let lastSequence = 4;
    const content: string[] = [];
    const handler = createChatStreamLineHandler({
      runId: "run-1",
      getLastSequence: () => lastSequence,
      onSequence: (sequence) => {
        lastSequence = sequence;
      },
      onContent: (text) => content.push(text),
      onReasoning: () => undefined,
      onMemory: (_event: SequencedMemoryStreamEvent) => undefined,
      onDone: () => undefined
    });

    handler("legacy raw text");

    assert.equal(lastSequence, 4);
    assert.deepEqual(content, ["legacy raw text"]);
  });

  it("still dispatches stale memory events after a server snapshot advances the cursor", () => {
    let lastSequence = 9;
    const memoryIds: string[] = [];
    const handler = createChatStreamLineHandler({
      runId: "run-1",
      getLastSequence: () => lastSequence,
      onSequence: (sequence) => {
        lastSequence = sequence;
      },
      onContent: () => undefined,
      onReasoning: () => undefined,
      onMemory: (event) => {
        if (event.action === "delete" && typeof event.id === "string") {
          memoryIds.push(event.id);
        }
      },
      onDone: () => undefined
    });

    handler(
      JSON.stringify({
        type: "memory",
        action: "delete",
        id: "memory-before-snapshot",
        runId: "run-1",
        seq: 8
      })
    );
    handler(
      JSON.stringify({
        type: "memory",
        action: "delete",
        id: "foreign-memory",
        runId: "run-2",
        seq: 8
      })
    );

    assert.equal(lastSequence, 9);
    assert.deepEqual(memoryIds, ["memory-before-snapshot"]);
  });
});
