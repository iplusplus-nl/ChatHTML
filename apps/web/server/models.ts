import type { Request, Response } from "express";
import { createProviderAuthorizationHeaders } from "./providerEndpointTrust.js";
import {
  readRuntimeApiCredentialDescriptor,
  resolveRuntimeApiCredentials
} from "./runtimeApiSettings.js";

const MAX_MODEL_IDS = 1_000;
const MAX_MODEL_ID_LENGTH = 180;
const DEFAULT_MODELS_TIMEOUT_MS = 10_000;
const DEFAULT_MODELS_RESPONSE_MAX_BYTES = 1_048_576;

export type ModelsHandlerOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  responseMaxBytes?: number;
};

class ModelsResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Models endpoint response exceeds the ${maxBytes} byte limit.`);
    this.name = "ModelsResponseTooLargeError";
  }
}

function normalizeModelsEndpoint(value: unknown, baseUrl: string): string {
  const input = typeof value === "string" ? value.trim() : "";
  const fallback = baseUrl ? `${baseUrl}/models` : "";
  const endpoint = input || fallback;

  if (!endpoint) {
    return "";
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    if (!baseUrl) {
      throw new Error("Models endpoint must be a valid URL.");
    }
    url = new URL(endpoint, `${baseUrl}/`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Models endpoint must use http or https.");
  }

  return url.toString();
}

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const modelId = value.trim().slice(0, MAX_MODEL_ID_LENGTH);
  if (!modelId || /[\r\n]/.test(modelId)) {
    return null;
  }

  return modelId;
}

function readModelId(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeModelId(value);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return normalizeModelId(record.id ?? record.name ?? record.model);
}

function extractModelIds(payload: unknown): string[] {
  const candidates: unknown[] = [];

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      candidates.push(...record.data);
    }
    if (Array.isArray(record.models)) {
      candidates.push(...record.models);
    }
  }

  const seen = new Set<string>();
  const modelIds: string[] = [];

  for (const candidate of candidates) {
    const modelId = readModelId(candidate);
    if (!modelId) {
      continue;
    }

    const key = modelId.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    modelIds.push(modelId);

    if (modelIds.length >= MAX_MODEL_IDS) {
      break;
    }
  }

  return modelIds;
}

async function readBoundedResponseText(
  response: globalThis.Response,
  maxBytes: number
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ModelsResponseTooLargeError(maxBytes);
  }
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
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ModelsResponseTooLargeError(maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createModelsHandler(options: ModelsHandlerOptions = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_MODELS_TIMEOUT_MS);
  const responseMaxBytes = Math.max(
    1,
    options.responseMaxBytes ?? DEFAULT_MODELS_RESPONSE_MAX_BYTES
  );

  return async function handleModelsRequest(
    req: Request,
    res: Response
  ): Promise<void> {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as { apiSettings?: unknown })
        : {};
    const object =
      typeof body.apiSettings === "object" && body.apiSettings !== null
        ? (body.apiSettings as Record<string, unknown>)
        : {};

    let endpoint: string;
    let credentials: ReturnType<typeof resolveRuntimeApiCredentials>;
    try {
      const descriptor = readRuntimeApiCredentialDescriptor(object);
      endpoint = normalizeModelsEndpoint(object.modelsEndpoint, descriptor.baseUrl);
      credentials = resolveRuntimeApiCredentials(descriptor, {
        endpoint,
        kind: "models"
      });
    } catch (error) {
      res.status(400).json({
        error: errorMessage(error, "API settings are invalid.")
      });
      return;
    }

    const missing: string[] = [];
    if (!endpoint) {
      missing.push("Models endpoint");
    }
    if (!credentials.apiKey) {
      missing.push(
        credentials.apiKeySource === "environment"
          ? credentials.apiKeyEnvironmentName
          : "API key"
      );
    }
    if (missing.length) {
      res
        .status(400)
        .json({ error: `API settings missing: ${missing.join(", ")}.` });
      return;
    }

    const abortController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        headers: {
          Accept: "application/json",
          ...createProviderAuthorizationHeaders(
            credentials,
            endpoint,
            "models"
          )
        },
        redirect: "error",
        signal: abortController.signal
      });
      const text = await readBoundedResponseText(response, responseMaxBytes);

      if (!response.ok) {
        throw new Error(
          `Models endpoint returned ${response.status}: ${text.slice(0, 500)}`
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Models endpoint returned invalid JSON.");
      }
      res.json({ models: extractModelIds(payload) });
    } catch (error) {
      res.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? `Models endpoint timed out after ${timeoutMs}ms.`
          : errorMessage(error, "Unable to fetch model list.")
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

export const handleModelsRequest = createModelsHandler();
