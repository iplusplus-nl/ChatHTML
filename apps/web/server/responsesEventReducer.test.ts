import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ResponsesTerminalFailureError,
  createResponsesEventAccumulator,
  extractResponsesOutputText,
  extractResponsesReasoningDelta,
  extractResponsesReasoningDoneText,
  finalizeResponsesEventAccumulator,
  reduceResponsesEvent
} from "./responsesEventReducer.js";

function reduceAll(events: unknown[]) {
  const accumulator = createResponsesEventAccumulator();
  const emitted = events.flatMap((event) =>
    reduceResponsesEvent(accumulator, event)
  );
  return {
    emitted,
    result: finalizeResponsesEventAccumulator(accumulator)
  };
}

describe("Responses event reducer", () => {
  it("emits text deltas and suppresses the matching done text", () => {
    const { emitted } = reduceAll([
      {
        type: "response.output_text.delta",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        delta: "Hello"
      },
      {
        type: "response.output_text.done",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        text: "Hello"
      }
    ]);

    assert.deepEqual(emitted, [{ type: "content", text: "Hello" }]);
  });

  it("uses done text when no delta was emitted for that content part", () => {
    const { emitted } = reduceAll([
      {
        type: "response.content_part.done",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "Complete text" }
      }
    ]);

    assert.deepEqual(emitted, [
      { type: "content", text: "Complete text" }
    ]);
  });

  it("emits refusal deltas and suppresses matching done and final refusal text", () => {
    const { emitted } = reduceAll([
      {
        type: "response.refusal.delta",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        delta: "I cannot help with that."
      },
      {
        type: "response.refusal.done",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        refusal: "I cannot help with that."
      },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                { type: "refusal", refusal: "I cannot help with that." }
              ]
            }
          ]
        }
      }
    ]);

    assert.deepEqual(emitted, [
      { type: "content", text: "I cannot help with that." }
    ]);
  });

  it("uses refusal done text when no refusal delta was emitted", () => {
    const { emitted } = reduceAll([
      {
        type: "response.refusal.done",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        refusal: "Request declined."
      }
    ]);

    assert.deepEqual(emitted, [
      { type: "content", text: "Request declined." }
    ]);
  });

  it("emits reasoning deltas and suppresses matching done text", () => {
    const events = [
      {
        type: "response.reasoning_summary_text.delta",
        item_id: "reason-1",
        delta: { summary_text: "Think" }
      },
      {
        type: "response.reasoning_summary_text.done",
        item_id: "reason-1",
        summary_text: "Think"
      }
    ];
    const { emitted } = reduceAll(events);

    assert.equal(extractResponsesReasoningDelta(events[0]), "Think");
    assert.equal(extractResponsesReasoningDoneText(events[1]), "Think");
    assert.deepEqual(emitted, [{ type: "reasoning", text: "Think" }]);
  });

  it("uses reasoning done text when no reasoning delta was emitted", () => {
    const { emitted } = reduceAll([
      {
        type: "response.reasoning_text.done",
        output_index: 0,
        text: "Finished reasoning"
      }
    ]);

    assert.deepEqual(emitted, [
      { type: "reasoning", text: "Finished reasoning" }
    ]);
  });

  it("accumulates function call argument deltas and final arguments", () => {
    const { result } = reduceAll([
      {
        type: "response.output_item.added",
        output_index: 2,
        item: {
          type: "function_call",
          id: "item-2",
          call_id: "call-2",
          name: "retrieve",
          arguments: ""
        }
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 2,
        item_id: "item-2",
        delta: "{\"query\":"
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 2,
        item_id: "item-2",
        delta: "\"news\"}"
      },
      {
        type: "response.function_call_arguments.done",
        output_index: 2,
        item_id: "item-2",
        arguments: "{\"query\":\"news\"}"
      },
      {
        type: "response.output_item.done",
        output_index: 2,
        item: {
          type: "function_call",
          id: "item-2",
          call_id: "call-2",
          name: "retrieve",
          arguments: "{\"query\":\"news\"}"
        }
      }
    ]);

    assert.deepEqual(result.functionCalls, [
      {
        type: "function_call",
        id: "item-2",
        call_id: "call-2",
        name: "retrieve",
        arguments: "{\"query\":\"news\"}"
      }
    ]);
  });

  it("fills visible text from the final response when no delta arrived", () => {
    const response = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "First" },
            { type: "output_text", text: " response" }
          ]
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "Second" }]
        }
      ]
    };
    const { emitted } = reduceAll([{ type: "response.done", response }]);

    assert.equal(extractResponsesOutputText(response), "First response\nSecond");
    assert.deepEqual(emitted, [
      { type: "content", text: "First response\nSecond" }
    ]);
  });

  it("fills visible text from a final refusal when no refusal event arrived", () => {
    const response = {
      output: [
        {
          type: "message",
          content: [
            { type: "refusal", refusal: "I cannot comply." }
          ]
        }
      ]
    };
    const { emitted } = reduceAll([
      { type: "response.completed", response }
    ]);

    assert.equal(extractResponsesOutputText(response), "I cannot comply.");
    assert.deepEqual(emitted, [
      { type: "content", text: "I cannot comply." }
    ]);
  });

  it("does not duplicate final response text after a text delta", () => {
    const { emitted } = reduceAll([
      { type: "response.output_text.delta", delta: "Visible" },
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Visible" }]
            }
          ]
        }
      }
    ]);

    assert.deepEqual(emitted, [{ type: "content", text: "Visible" }]);
  });

  it("captures failed, incomplete, and cancelled terminal failures", () => {
    const failed = reduceAll([
      {
        type: "response.failed",
        response: {
          status: "failed",
          error: { message: "Provider failed" }
        }
      }
    ]).result.terminalFailure;
    const incomplete = reduceAll([
      {
        type: "response.incomplete",
        response: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" }
        }
      }
    ]).result.terminalFailure;
    const cancelled = reduceAll([
      { type: "response.cancelled", error: { message: "Provider cancelled" } }
    ]).result.terminalFailure;

    assert.deepEqual(failed, {
      message: "Provider failed",
      status: "failed",
      incompleteReason: ""
    });
    assert.deepEqual(incomplete, {
      message: "Responses API returned incomplete.",
      status: "incomplete",
      incompleteReason: "max_output_tokens"
    });
    assert.deepEqual(cancelled, {
      message: "Provider cancelled",
      status: "cancelled",
      incompleteReason: ""
    });
  });

  it("treats an official error event as terminal after partial content", () => {
    const { emitted, result } = reduceAll([
      {
        type: "response.output_text.delta",
        item_id: "message-1",
        delta: "Partial answer"
      },
      {
        type: "error",
        code: "server_error",
        message: "Provider stream failed",
        param: null
      }
    ]);

    assert.deepEqual(emitted, [
      { type: "content", text: "Partial answer" }
    ]);
    assert.equal(result.terminalEventReceived, true);
    assert.deepEqual(result.terminalFailure, {
      message: "Provider stream failed",
      status: "error",
      incompleteReason: ""
    });
  });

  it("exposes terminal failure metadata through its typed error", () => {
    const error = new ResponsesTerminalFailureError({
      message: "Incomplete",
      status: "incomplete",
      incompleteReason: "max_output_tokens"
    });

    assert.equal(error.name, "ResponsesTerminalFailureError");
    assert.equal(error.message, "Incomplete");
    assert.equal(error.status, "incomplete");
    assert.equal(error.incompleteReason, "max_output_tokens");
  });
});
