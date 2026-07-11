import assert from "node:assert/strict";
import test from "node:test";
import {
  ResponsesToolStepLimitError,
  runResponsesToolLoop
} from "./responsesToolLoop.js";

type Call = { id: string };

test("max=1 rejects when the only model turn requests a function call", async () => {
  const calls: string[] = [];

  await assert.rejects(
    runResponsesToolLoop<Call, string>({
      maxSteps: 1,
      signal: new AbortController().signal,
      streamStep: async () => [{ id: "lookup" }],
      executeTool: async (call) => {
        calls.push(`execute:${call.id}`);
        return "result";
      },
      onToolCall: (call) => calls.push(`call:${call.id}`),
      onToolResult: (call, result) => calls.push(`result:${call.id}:${result}`),
      hasVisibleResponse: () => false
    }),
    (error) =>
      error instanceof ResponsesToolStepLimitError &&
      error.maxSteps === 1 &&
      /no follow-up response/.test(error.message)
  );

  assert.deepEqual(calls, [
    "call:lookup",
    "execute:lookup",
    "result:lookup:result"
  ]);
});

test("a visible tool-free turn completes normally", async () => {
  let visible = false;
  const result = await runResponsesToolLoop<Call, string>({
    maxSteps: 2,
    signal: new AbortController().signal,
    streamStep: async () => {
      visible = true;
      return [];
    },
    executeTool: async () => "unused",
    onToolCall: () => undefined,
    onToolResult: () => undefined,
    hasVisibleResponse: () => visible
  });

  assert.deepEqual(result, { steps: 1, toolCalls: 0 });
});

test("unlimited mode supports multiple tool turns before visible completion", async () => {
  const streamed: number[] = [];
  const appended: string[] = [];
  let visible = false;

  const result = await runResponsesToolLoop<Call, string>({
    maxSteps: null,
    signal: new AbortController().signal,
    streamStep: async (step) => {
      streamed.push(step);
      if (step === 0) {
        return [{ id: "first" }];
      }
      if (step === 1) {
        return [{ id: "second" }];
      }
      visible = true;
      return [];
    },
    executeTool: async (call) => `${call.id}-output`,
    onToolCall: (call) => appended.push(`call:${call.id}`),
    onToolResult: (call, output) =>
      appended.push(`output:${call.id}:${output}`),
    hasVisibleResponse: () => visible
  });

  assert.deepEqual(streamed, [0, 1, 2]);
  assert.deepEqual(appended, [
    "call:first",
    "output:first:first-output",
    "call:second",
    "output:second:second-output"
  ]);
  assert.deepEqual(result, { steps: 3, toolCalls: 2 });
});
