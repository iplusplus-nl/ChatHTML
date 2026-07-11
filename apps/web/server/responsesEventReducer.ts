import type {
  ResponsesInputContentPart,
  ResponsesToolOutput
} from "./sessionFileTools.js";

export type ResponsesInputMessage =
  | {
      type: "message";
      role: "user";
      content: ResponsesInputContentPart[];
    }
  | {
      type: "message";
      role: "assistant";
      id: string;
      status: "completed";
      content: Array<{
        type: "output_text";
        text: string;
        annotations: unknown[];
      }>;
    };

export type ResponsesFunctionCallItem = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

export type ResponsesFunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: ResponsesToolOutput;
};

export type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

export type ResponsesStreamEvent = {
  type: "content" | "reasoning";
  text: string;
};

export type ResponsesTerminalFailure = {
  message: string;
  status?: string;
  incompleteReason?: string;
};

export class ResponsesTerminalFailureError extends Error {
  readonly status?: string;
  readonly incompleteReason?: string;

  constructor(failure: ResponsesTerminalFailure) {
    super(failure.message);
    this.name = "ResponsesTerminalFailureError";
    this.status = failure.status;
    this.incompleteReason = failure.incompleteReason;
  }
}

export type ResponsesEventAccumulator = {
  calls: Map<string, ResponsesFunctionCallItem>;
  callsByOutputIndex: Map<number, ResponsesFunctionCallItem>;
  callsByItemId: Map<string, ResponsesFunctionCallItem>;
  functionArgumentDeltas: Map<string, string>;
  textDeltaCharsByKey: Map<string, number>;
  reasoningDeltaCharsByKey: Map<string, number>;
  contentEmitted: boolean;
  terminalEventReceived: boolean;
  terminalFailure?: ResponsesTerminalFailure;
};

export type ResponsesEventAccumulatorResult = {
  functionCalls: ResponsesFunctionCallItem[];
  terminalEventReceived: boolean;
  terminalFailure?: ResponsesTerminalFailure;
};

export function createResponsesEventAccumulator(): ResponsesEventAccumulator {
  return {
    calls: new Map(),
    callsByOutputIndex: new Map(),
    callsByItemId: new Map(),
    functionArgumentDeltas: new Map(),
    textDeltaCharsByKey: new Map(),
    reasoningDeltaCharsByKey: new Map(),
    contentEmitted: false,
    terminalEventReceived: false
  };
}

function safeJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseResponsesEventPayload(
  value: string
): Record<string, unknown> | undefined {
  const payload = value.trim();
  if (!payload || payload === "[DONE]") {
    return undefined;
  }
  return safeJsonRecord(payload);
}

export function normalizeResponsesFunctionCall(
  input: unknown
): ResponsesFunctionCallItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const item = input as Partial<ResponsesFunctionCallItem>;
  if (
    item.type !== "function_call" ||
    typeof item.call_id !== "string" ||
    typeof item.name !== "string"
  ) {
    return null;
  }

  return {
    type: "function_call",
    id: typeof item.id === "string" ? item.id : undefined,
    call_id: item.call_id,
    name: item.name,
    arguments: typeof item.arguments === "string" ? item.arguments : "{}"
  };
}

function mergeFunctionCall(
  map: Map<string, ResponsesFunctionCallItem>,
  call: ResponsesFunctionCallItem | null
): void {
  if (!call) {
    return;
  }

  const existing = map.get(call.call_id);
  map.set(call.call_id, {
    ...existing,
    ...call,
    arguments: call.arguments || existing?.arguments || "{}"
  });
}

function appendFunctionCallsFromOutput(
  output: unknown,
  map: Map<string, ResponsesFunctionCallItem>
): void {
  if (!Array.isArray(output)) {
    return;
  }

  for (const item of output) {
    mergeFunctionCall(map, normalizeResponsesFunctionCall(item));
  }
}

function getResponsesTextEventKey(data: Record<string, unknown>): string {
  const itemId = typeof data.item_id === "string" ? data.item_id : "";
  const outputIndex =
    typeof data.output_index === "number" ? String(data.output_index) : "";
  const contentIndex =
    typeof data.content_index === "number" ? String(data.content_index) : "";

  return [itemId, outputIndex, contentIndex].filter(Boolean).join(":") || "0";
}

function getStringProperty(
  input: Record<string, unknown>,
  names: string[]
): string {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

function isResponsesReasoningEvent(type: unknown): type is string {
  return typeof type === "string" && type.toLowerCase().includes("reasoning");
}

export function extractResponsesReasoningDelta(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }

  const data = event as Record<string, unknown>;
  const type = data.type;
  if (!isResponsesReasoningEvent(type) || !type.endsWith(".delta")) {
    return "";
  }

  const delta = data.delta;
  if (typeof delta === "string") {
    return delta;
  }
  if (delta && typeof delta === "object") {
    return getStringProperty(delta as Record<string, unknown>, [
      "text",
      "summary_text",
      "content"
    ]);
  }

  return getStringProperty(data, ["text", "summary_text", "content"]);
}

export function extractResponsesReasoningDoneText(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }

  const data = event as Record<string, unknown>;
  const type = data.type;
  if (!isResponsesReasoningEvent(type) || !type.endsWith(".done")) {
    return "";
  }

  return getStringProperty(data, ["text", "summary_text", "content"]);
}

function responsesContentText(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const content = input as {
    type?: unknown;
    text?: unknown;
    refusal?: unknown;
    content?: unknown;
  };
  if (
    (content.type === "output_text" || content.type === "text") &&
    typeof content.text === "string"
  ) {
    return content.text;
  }
  if (content.type === "refusal" && typeof content.refusal === "string") {
    return content.refusal;
  }

  if (Array.isArray(content.content)) {
    return content.content.map(responsesContentText).filter(Boolean).join("");
  }

  return "";
}

export function extractResponsesOutputText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const candidate = item as { type?: unknown; content?: unknown };
      if (candidate.type !== "message" || !Array.isArray(candidate.content)) {
        return "";
      }

      return candidate.content.map(responsesContentText).filter(Boolean).join("");
    })
    .filter(Boolean)
    .join("\n");
}

export function extractResponsesErrorMessage(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const error = input as {
    message?: unknown;
    code?: unknown;
    type?: unknown;
    error?: unknown;
  };
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error.error === "string" && error.error.trim()) {
    return error.error.trim();
  }
  if (error.error && typeof error.error === "object") {
    return extractResponsesErrorMessage(error.error);
  }

  const parts = [error.type, error.code]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0
    )
    .map((part) => part.trim());
  return parts.join(": ");
}

function getResponsesEventStatus(
  event: Record<string, unknown>,
  response: Record<string, unknown>
): string {
  const responseStatus =
    typeof response.status === "string" ? response.status.trim() : "";
  if (responseStatus) {
    return responseStatus;
  }

  const eventType = typeof event.type === "string" ? event.type : "";
  if (eventType === "response.failed") {
    return "failed";
  }
  if (eventType === "response.cancelled") {
    return "cancelled";
  }
  if (eventType === "response.incomplete") {
    return "incomplete";
  }
  if (eventType === "error") {
    return "error";
  }
  return "";
}

function responsesIncompleteReason(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const details = input as { reason?: unknown; error?: unknown };
  const reason =
    typeof details.reason === "string"
      ? details.reason.trim().slice(0, 160)
      : "";
  if (reason) {
    return reason;
  }
  if (details.error && typeof details.error === "object") {
    return responsesIncompleteReason(details.error);
  }
  return "";
}

export function getResponsesTerminalFailure(
  event: Record<string, unknown>
): ResponsesTerminalFailure | undefined {
  const response =
    event.response && typeof event.response === "object"
      ? (event.response as Record<string, unknown>)
      : event;
  const status = getResponsesEventStatus(event, response);
  const incompleteDetails = response.incomplete_details ?? event.incomplete_details;
  const incompleteReason = responsesIncompleteReason(incompleteDetails);

  if (status === "incomplete") {
    return {
      message: "Responses API returned incomplete.",
      status,
      incompleteReason
    };
  }

  const directError = extractResponsesErrorMessage(
    event.error ?? response.error ?? (event.type === "error" ? event : undefined)
  );
  if (directError) {
    return { message: directError, status, incompleteReason };
  }

  const incomplete = extractResponsesErrorMessage(incompleteDetails);
  if (status === "failed" || status === "cancelled" || status === "incomplete") {
    return {
      message:
        incomplete ||
        `Responses API returned ${status || "an incomplete response"}.`,
      status,
      incompleteReason
    };
  }

  return incomplete
    ? {
        message: incomplete,
        status,
        incompleteReason
      }
    : undefined;
}

function findPendingFunctionCall(
  accumulator: ResponsesEventAccumulator,
  data: Record<string, unknown>
): ResponsesFunctionCallItem | undefined {
  const outputIndex =
    typeof data.output_index === "number" ? data.output_index : undefined;
  const itemId = typeof data.item_id === "string" ? data.item_id : "";
  return (
    (typeof outputIndex === "number"
      ? accumulator.callsByOutputIndex.get(outputIndex)
      : undefined) ?? accumulator.callsByItemId.get(itemId)
  );
}

function emitText(
  accumulator: ResponsesEventAccumulator,
  type: ResponsesStreamEvent["type"],
  text: string,
  key: string
): ResponsesStreamEvent[] {
  if (!text) {
    return [];
  }

  const counts =
    type === "content"
      ? accumulator.textDeltaCharsByKey
      : accumulator.reasoningDeltaCharsByKey;
  counts.set(key, (counts.get(key) ?? 0) + text.length);
  if (type === "content") {
    accumulator.contentEmitted = true;
  }
  return [{ type, text }];
}

function emitDoneTextIfNeeded(
  accumulator: ResponsesEventAccumulator,
  type: ResponsesStreamEvent["type"],
  data: Record<string, unknown>,
  text: string
): ResponsesStreamEvent[] {
  const key = getResponsesTextEventKey(data);
  const counts =
    type === "content"
      ? accumulator.textDeltaCharsByKey
      : accumulator.reasoningDeltaCharsByKey;
  if (!text || (counts.get(key) ?? 0) > 0) {
    return [];
  }
  return emitText(accumulator, type, text, key);
}

export function reduceResponsesEvent(
  accumulator: ResponsesEventAccumulator,
  event: unknown
): ResponsesStreamEvent[] {
  if (!event || typeof event !== "object") {
    return [];
  }

  const data = event as Record<string, unknown>;
  const type = data.type;
  if (
    (type === "response.content_part.delta" ||
      type === "response.output_text.delta" ||
      type === "response.refusal.delta") &&
    typeof data.delta === "string"
  ) {
    return emitText(
      accumulator,
      "content",
      data.delta,
      getResponsesTextEventKey(data)
    );
  }

  if (type === "response.output_text.done" && typeof data.text === "string") {
    return emitDoneTextIfNeeded(accumulator, "content", data, data.text);
  }

  if (type === "response.refusal.done") {
    return emitDoneTextIfNeeded(
      accumulator,
      "content",
      data,
      getStringProperty(data, ["refusal", "text"])
    );
  }

  if (type === "response.content_part.done") {
    return emitDoneTextIfNeeded(
      accumulator,
      "content",
      data,
      responsesContentText(data.part)
    );
  }

  const reasoningDelta = extractResponsesReasoningDelta(data);
  if (reasoningDelta) {
    return emitText(
      accumulator,
      "reasoning",
      reasoningDelta,
      getResponsesTextEventKey(data)
    );
  }

  const reasoningDoneText = extractResponsesReasoningDoneText(data);
  if (reasoningDoneText) {
    return emitDoneTextIfNeeded(
      accumulator,
      "reasoning",
      data,
      reasoningDoneText
    );
  }

  if (
    type === "response.failed" ||
    type === "response.incomplete" ||
    type === "response.cancelled" ||
    type === "error"
  ) {
    accumulator.terminalEventReceived = true;
    accumulator.terminalFailure = getResponsesTerminalFailure(data);
    return [];
  }

  if (type === "response.output_item.added") {
    const call = normalizeResponsesFunctionCall(data.item);
    if (call) {
      const outputIndex =
        typeof data.output_index === "number" ? data.output_index : undefined;
      if (typeof outputIndex === "number") {
        accumulator.callsByOutputIndex.set(outputIndex, call);
      }
      if (call.id) {
        accumulator.callsByItemId.set(call.id, call);
      }
    }
    return [];
  }

  if (type === "response.function_call_arguments.delta") {
    const target = findPendingFunctionCall(accumulator, data);
    if (target && typeof data.delta === "string") {
      const argumentsText =
        (accumulator.functionArgumentDeltas.get(target.call_id) ?? "") +
        data.delta;
      accumulator.functionArgumentDeltas.set(target.call_id, argumentsText);
      target.arguments = argumentsText;
    }
    return [];
  }

  if (type === "response.function_call_arguments.done") {
    const target = findPendingFunctionCall(accumulator, data);
    if (target) {
      if (typeof data.arguments === "string") {
        target.arguments = data.arguments;
      }
      mergeFunctionCall(accumulator.calls, target);
    }
    return [];
  }

  if (type === "response.output_item.done") {
    mergeFunctionCall(
      accumulator.calls,
      normalizeResponsesFunctionCall(data.item) ??
        findPendingFunctionCall(accumulator, data) ??
        null
    );
    return [];
  }

  if (type === "response.done" || type === "response.completed") {
    accumulator.terminalEventReceived = true;
    if (!data.response || typeof data.response !== "object") {
      return [];
    }
    accumulator.terminalFailure =
      accumulator.terminalFailure ?? getResponsesTerminalFailure(data);
    appendFunctionCallsFromOutput(
      (data.response as { output?: unknown }).output,
      accumulator.calls
    );
    if (!accumulator.contentEmitted) {
      const text = extractResponsesOutputText(data.response);
      if (text) {
        accumulator.contentEmitted = true;
        return [{ type: "content", text }];
      }
    }
  }

  return [];
}

export function finalizeResponsesEventAccumulator(
  accumulator: ResponsesEventAccumulator
): ResponsesEventAccumulatorResult {
  return {
    functionCalls: Array.from(accumulator.calls.values()),
    terminalEventReceived: accumulator.terminalEventReceived,
    terminalFailure: accumulator.terminalFailure
  };
}
