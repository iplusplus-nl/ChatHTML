export type ResponsesToolLoopOptions<TCall, TResult> = {
  maxSteps: number | null;
  signal: AbortSignal;
  streamStep: (step: number) => Promise<readonly TCall[]>;
  executeTool: (call: TCall) => Promise<TResult>;
  onToolCall: (call: TCall) => void;
  onToolResult: (call: TCall, result: TResult) => void;
  hasVisibleResponse: () => boolean;
};

export type ResponsesToolLoopResult = {
  steps: number;
  toolCalls: number;
};

export class ResponsesToolStepLimitError extends Error {
  readonly maxSteps: number;

  constructor(maxSteps: number) {
    super(
      `The model requested tool calls at the configured maximum of ${maxSteps} step${maxSteps === 1 ? "" : "s"}; no follow-up response was generated.`
    );
    this.name = "ResponsesToolStepLimitError";
    this.maxSteps = maxSteps;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason;
  }
}

/**
 * Runs Responses API turns until the model produces a visible, tool-free
 * terminal turn. A turn containing function calls is never terminal: every
 * tool result must be submitted to a later model turn.
 */
export async function runResponsesToolLoop<TCall, TResult>({
  maxSteps,
  signal,
  streamStep,
  executeTool,
  onToolCall,
  onToolResult,
  hasVisibleResponse
}: ResponsesToolLoopOptions<TCall, TResult>): Promise<ResponsesToolLoopResult> {
  let steps = 0;
  let toolCalls = 0;

  while (maxSteps === null || steps < maxSteps) {
    throwIfAborted(signal);
    const calls = await streamStep(steps);
    steps += 1;
    throwIfAborted(signal);

    if (!calls.length) {
      if (!hasVisibleResponse()) {
        throw new Error("The model completed without producing a visible response.");
      }
      return { steps, toolCalls };
    }

    for (const call of calls) {
      throwIfAborted(signal);
      onToolCall(call);
      const result = await executeTool(call);
      throwIfAborted(signal);
      onToolResult(call, result);
      toolCalls += 1;
    }
  }

  // The last permitted model turn requested tools, so their outputs have not
  // yet been observed by the model. Treating this as complete would persist an
  // empty or partial assistant message.
  throw new ResponsesToolStepLimitError(maxSteps);
}
