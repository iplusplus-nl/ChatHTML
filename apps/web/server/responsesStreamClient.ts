import type { ApiKeySource, RuntimeReasoningEffort } from "./runtimeApiSettings.js";
import { createProviderAuthorizationHeaders } from "./providerEndpointTrust.js";
import type { ResponsesToolDefinition } from "./sessionFileTools.js";
import {
  ResponsesTerminalFailureError,
  createResponsesEventAccumulator,
  extractResponsesErrorMessage,
  finalizeResponsesEventAccumulator,
  parseResponsesEventPayload,
  reduceResponsesEvent,
  type ResponsesFunctionCallItem,
  type ResponsesInputItem,
  type ResponsesStreamEvent
} from "./responsesEventReducer.js";

export const RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
export const RESPONSES_MAX_ERROR_BODY_BYTES = 262_144;
export const RESPONSES_MAX_STREAM_BYTES = 67_108_864;
export const RESPONSES_MAX_SSE_LINE_CHARS = 2_097_152;

export type ResponsesHttpErrorContext = {
  providerName: string;
  baseUrl: string;
  apiKeySource: ApiKeySource;
  apiKeyEnvironmentName: string;
  apiKey: string;
};

export type ResponsesStreamApiSettings = ResponsesHttpErrorContext & {
  model: string;
  reasoningEffort: RuntimeReasoningEffort;
};

export type ResponsesStreamState = {
  contentChars: number;
  contentEvents: number;
  reasoningChars: number;
  reasoningEvents: number;
};

export type ResponsesStreamEventWriter = (event: ResponsesStreamEvent) => void;

export type StreamResponsesOnceOptions = {
  endpoint: string;
  apiSettings: ResponsesStreamApiSettings;
  input: ResponsesInputItem[];
  instructions: string;
  tools: ResponsesToolDefinition[];
  emit: ResponsesStreamEventWriter;
  state: ResponsesStreamState;
  signal: AbortSignal;
  useOpenRouterReasoning: boolean;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
};

export function isOpenRouterRuntime(
  settings: Pick<ResponsesHttpErrorContext, "providerName" | "baseUrl">
): boolean {
  return (
    /openrouter/i.test(settings.providerName) ||
    settings.baseUrl.toLowerCase().includes("openrouter.ai")
  );
}

function isOpenAiRuntime(
  settings: Pick<ResponsesHttpErrorContext, "providerName" | "baseUrl">
): boolean {
  return (
    /openai/i.test(settings.providerName) ||
    settings.baseUrl.toLowerCase().includes("api.openai.com")
  );
}

function getApiKeyDisplayName(
  settings: Pick<
    ResponsesHttpErrorContext,
    "apiKeySource" | "apiKeyEnvironmentName"
  >
): string {
  return settings.apiKeySource === "manual"
    ? "manual API key"
    : settings.apiKeyEnvironmentName || "configured API key";
}

function getApiKeyUpdateAction(
  settings: Pick<
    ResponsesHttpErrorContext,
    "apiKeySource" | "apiKeyEnvironmentName"
  >
): string {
  const label = getApiKeyDisplayName(settings);
  return settings.apiKeySource === "manual"
    ? "Update it in Settings."
    : `Update ${label} and restart the server.`;
}

function looksLikeOpenRouterKey(apiKey: string): boolean {
  return /^sk-or-/i.test(apiKey.trim());
}

function looksLikeOpenAiKey(apiKey: string): boolean {
  return /^sk-(?!or-)/i.test(apiKey.trim());
}

export function describeApiCredentialMismatch(
  settings: ResponsesHttpErrorContext
): string {
  const label = getApiKeyDisplayName(settings);

  if (isOpenRouterRuntime(settings) && looksLikeOpenAiKey(settings.apiKey)) {
    return `API credential mismatch: ${label} looks like an OpenAI key, but the Base URL points to OpenRouter (${settings.baseUrl}). Use an OpenRouter key from https://openrouter.ai/keys (usually starts with sk-or-) or switch the provider/base URL to OpenAI.`;
  }

  if (isOpenAiRuntime(settings) && looksLikeOpenRouterKey(settings.apiKey)) {
    return `API credential mismatch: ${label} looks like an OpenRouter key, but the Base URL points to OpenAI (${settings.baseUrl}). Use an OpenAI API key or switch the provider/base URL to OpenRouter.`;
  }

  return "";
}

function getUnauthorizedCredentialHint(
  status: number,
  settings: ResponsesHttpErrorContext
): string {
  if (status !== 401) {
    return "";
  }

  const label = getApiKeyDisplayName(settings);
  const action = getApiKeyUpdateAction(settings);

  if (isOpenRouterRuntime(settings)) {
    return `Check ${label}: OpenRouter returns 401 for invalid or wrong-platform keys. Use an OpenRouter key from https://openrouter.ai/keys (usually starts with sk-or-). ${action}`;
  }

  if (isOpenAiRuntime(settings)) {
    return `Check ${label}: the OpenAI endpoint requires an OpenAI API key, not an OpenRouter key. ${action}`;
  }

  return `Check ${label}: the provider rejected the configured API key. ${action}`;
}

function compactErrorText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtmlTags(value: string): string {
  return compactErrorText(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
  );
}

function looksLikeHtml(value: string): boolean {
  return /<!doctype\s+html|<html\b|<head\b|<body\b|<\/?[a-z][\s\S]*>/i.test(
    value
  );
}

function extractHtmlTitle(value: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(value);
  return match ? stripHtmlTags(match[1]) : "";
}

export function summarizeHttpErrorBody(
  value: string,
  fallback = "The provider returned an error."
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const jsonMessage = extractResponsesErrorMessage(parsed);
    if (jsonMessage) {
      return compactErrorText(jsonMessage).slice(0, 500);
    }
  } catch {
    // The provider may return plain text or an HTML proxy error page.
  }

  if (looksLikeHtml(trimmed)) {
    const title = extractHtmlTitle(trimmed);
    const text = title || stripHtmlTags(trimmed);
    return (text || fallback).slice(0, 180);
  }

  return compactErrorText(trimmed).slice(0, 500);
}

export function formatResponsesHttpError(
  response: { status: number; statusText?: string },
  bodyText: string,
  settings?: ResponsesHttpErrorContext
): string {
  const statusText = compactErrorText(response.statusText || "");
  const status = `HTTP ${response.status}${statusText ? ` ${statusText}` : ""}`;
  const detail = summarizeHttpErrorBody(bodyText, "");
  const prefix = `Responses API request failed with ${status}.`;
  const hint = settings
    ? getUnauthorizedCredentialHint(response.status, settings)
    : "";
  const visibleDetail =
    detail && !detail.toLowerCase().includes(String(response.status))
      ? detail
      : "";

  return [prefix, visibleDetail, hint].filter(Boolean).join(" ");
}

export function getResponsesEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/responses`;
}

function getResponsesReasoning(
  reasoningEffort: RuntimeReasoningEffort,
  useOpenRouterReasoning: boolean
): { effort: Exclude<RuntimeReasoningEffort, "none" | "xhigh"> } | undefined {
  if (!useOpenRouterReasoning || reasoningEffort === "none") {
    return undefined;
  }

  return {
    effort: reasoningEffort === "xhigh" ? "high" : reasoningEffort
  };
}

function createResponsesAbortError(): Error {
  const error = new Error("Generation stopped.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createResponsesAbortError();
  }
}

function writeResponsesStreamEvent(
  emit: ResponsesStreamEventWriter,
  event: ResponsesStreamEvent,
  state: ResponsesStreamState
): void {
  if (!event.text) {
    return;
  }
  if (event.type === "content") {
    state.contentChars += event.text.length;
    state.contentEvents += 1;
  } else {
    state.reasoningChars += event.text.length;
    state.reasoningEvents += 1;
  }
  emit(event);
}

async function readResponseText(
  response: Response,
  maxBytes = RESPONSES_MAX_ERROR_BODY_BYTES
): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        return text;
      }
      const remainingBytes = maxBytes - totalBytes;
      if (value.byteLength > remainingBytes) {
        if (remainingBytes > 0) {
          text += decoder.decode(value.subarray(0, remainingBytes), {
            stream: true
          });
        }
        await reader.cancel().catch(() => undefined);
        return `${text}${decoder.decode()} [response body truncated]`;
      }
      totalBytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
}

export async function streamResponsesOnce({
  endpoint,
  apiSettings,
  input,
  instructions,
  tools,
  emit,
  state,
  signal,
  useOpenRouterReasoning,
  maxOutputTokens = RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS,
  fetchImpl = globalThis.fetch
}: StreamResponsesOnceOptions): Promise<ResponsesFunctionCallItem[]> {
  throwIfAborted(signal);

  const body: Record<string, unknown> = {
    model: apiSettings.model,
    input,
    instructions,
    stream: true,
    max_output_tokens: maxOutputTokens
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const reasoning = getResponsesReasoning(
    apiSettings.reasoningEffort,
    useOpenRouterReasoning
  );
  if (reasoning) {
    body.reasoning = reasoning;
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        ...createProviderAuthorizationHeaders(
          apiSettings,
          endpoint,
          "responses"
        ),
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "ChatHTML Runtime Demo"
      },
      redirect: "error",
      signal,
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (signal.aborted) {
      throw createResponsesAbortError();
    }
    throw error;
  }

  if (!response.ok || !response.body) {
    const text = await readResponseText(response);
    throw new Error(formatResponsesHttpError(response, text, apiSettings));
  }

  const accumulator = createResponsesEventAccumulator();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalStreamBytes = 0;
  let doneSentinelReceived = false;

  const handleLine = (line: string): void => {
    if (line.length > RESPONSES_MAX_SSE_LINE_CHARS) {
      throw new Error(
        `Responses API stream contains a line longer than ${RESPONSES_MAX_SSE_LINE_CHARS} characters.`
      );
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      doneSentinelReceived = true;
      return;
    }
    const event = parseResponsesEventPayload(payload);
    if (!event) {
      return;
    }
    for (const streamEvent of reduceResponsesEvent(accumulator, event)) {
      writeResponsesStreamEvent(emit, streamEvent, state);
    }
  };

  const flushCompleteLines = (): void => {
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(handleLine);
  };

  const reader = response.body.getReader();
  let readerCancelPromise: Promise<void> | undefined;
  const cancelReader = (): Promise<void> => {
    readerCancelPromise ??= reader.cancel().catch(() => undefined);
    return readerCancelPromise;
  };
  const handleAbort = (): void => {
    void cancelReader();
  };
  signal.addEventListener("abort", handleAbort, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) {
        break;
      }

      totalStreamBytes += value.byteLength;
      if (totalStreamBytes > RESPONSES_MAX_STREAM_BYTES) {
        await cancelReader();
        throw new Error(
          `Responses API stream exceeds the ${RESPONSES_MAX_STREAM_BYTES} byte limit.`
        );
      }
      buffer += decoder.decode(value, { stream: true });
      flushCompleteLines();
      if (buffer.length > RESPONSES_MAX_SSE_LINE_CHARS) {
        await cancelReader();
        throw new Error(
          `Responses API stream contains a line longer than ${RESPONSES_MAX_SSE_LINE_CHARS} characters.`
        );
      }
    }
  } catch (error) {
    if (signal.aborted) {
      throw createResponsesAbortError();
    }
    await cancelReader();
    throw error;
  } finally {
    signal.removeEventListener("abort", handleAbort);
    if (signal.aborted) {
      await cancelReader();
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    buffer.split(/\r\n|\r|\n/).forEach(handleLine);
  }

  const result = finalizeResponsesEventAccumulator(accumulator);
  if (result.terminalFailure) {
    throw new ResponsesTerminalFailureError(result.terminalFailure);
  }
  if (!result.terminalEventReceived && !doneSentinelReceived) {
    throw new ResponsesTerminalFailureError({
      message: "Responses API stream ended before a terminal event.",
      status: "incomplete",
      incompleteReason: "stream_eof"
    });
  }
  return result.functionCalls;
}
