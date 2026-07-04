import type { Request, Response } from "express";

export type ApiKeySource = "environment" | "manual";

export type RuntimeReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type RuntimeApiCredentials = {
  providerName: string;
  baseUrl: string;
  apiKeySource: ApiKeySource;
  apiKeyEnvironmentName: string;
  apiKey: string;
};

export type RuntimeApiDefaults = {
  providerId: "openrouter";
  providerName: "OpenRouter";
  baseUrl: string;
  apiKeySource: "environment";
  apiKey: "";
  model: string;
  modelOptions: string[];
  modelsEndpoint: string;
  reasoningEffort: RuntimeReasoningEffort;
  userPreference: "";
};

export type EnvironmentKeyStatus = {
  name: string;
  configured: boolean;
};

export type RuntimeSettingsSummary = {
  api: {
    defaults: RuntimeApiDefaults;
    environmentKeys: EnvironmentKeyStatus[];
  };
  search: {
    environmentKeys: EnvironmentKeyStatus[];
  };
};

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.1-pro-preview";
const DEFAULT_OPENROUTER_REASONING: RuntimeReasoningEffort = "low";

const API_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "STREAMUI_API_KEY"
];

const SEARCH_ENV_KEYS = [
  "BRAVE_SEARCH_API_KEY",
  "TAVILY_API_KEY",
  "SERPER_API_KEY"
];

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function envString(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function hasEnvValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function environmentKeyStatus(names: string[]): EnvironmentKeyStatus[] {
  return names.map((name) => ({
    name,
    configured: hasEnvValue(name)
  }));
}

function getDefaultModelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized ? `${normalized}/models` : "";
}

export function normalizeRuntimeReasoningEffort(
  value: unknown,
  fallback: RuntimeReasoningEffort = DEFAULT_OPENROUTER_REASONING
): RuntimeReasoningEffort {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }

  return fallback;
}

export function getRuntimeApiDefaults(): RuntimeApiDefaults {
  const baseUrl =
    envString("OPENROUTER_BASE_URL", "OPENROUTER_API_BASE_URL") ||
    DEFAULT_OPENROUTER_BASE_URL;
  const model = envString("OPENROUTER_MODEL") || DEFAULT_OPENROUTER_MODEL;

  return {
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl,
    apiKeySource: "environment",
    apiKey: "",
    model,
    modelOptions: [model],
    modelsEndpoint:
      envString("OPENROUTER_MODELS_ENDPOINT") || getDefaultModelsEndpoint(baseUrl),
    reasoningEffort: normalizeRuntimeReasoningEffort(
      envString("OPENROUTER_REASONING_EFFORT")
    ),
    userPreference: ""
  };
}

export function getRuntimeSettingsSummary(): RuntimeSettingsSummary {
  return {
    api: {
      defaults: getRuntimeApiDefaults(),
      environmentKeys: environmentKeyStatus(API_ENV_KEYS)
    },
    search: {
      environmentKeys: environmentKeyStatus(SEARCH_ENV_KEYS)
    }
  };
}

export function handleGetRuntimeSettings(_req: Request, res: Response): void {
  res.json(getRuntimeSettingsSummary());
}

export function normalizeBaseUrl(value: unknown): string {
  const input = typeof value === "string" ? value.trim() : "";

  if (!input) {
    return "";
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("API settings invalid: Base URL must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("API settings invalid: Base URL must use http or https.");
  }

  return input.replace(/\/+$/, "");
}

export function normalizeApiKeySource(value: unknown): ApiKeySource {
  if (value === "environment" || value === "manual") {
    return value;
  }

  return "environment";
}

export function getApiKeyEnvironmentName(
  providerName: string,
  baseUrl: string,
  providerId: unknown
): string {
  const normalizedProviderId =
    typeof providerId === "string" ? providerId.toLowerCase() : "";
  const normalizedProviderName = providerName.toLowerCase();
  const normalizedBaseUrl = baseUrl.toLowerCase();

  if (
    normalizedProviderId === "openrouter" ||
    normalizedProviderName.includes("openrouter") ||
    normalizedBaseUrl.includes("openrouter.ai")
  ) {
    return "OPENROUTER_API_KEY";
  }
  if (
    normalizedProviderId === "openai" ||
    normalizedProviderName.includes("openai") ||
    normalizedBaseUrl.includes("api.openai.com")
  ) {
    return "OPENAI_API_KEY";
  }

  return "STREAMUI_API_KEY";
}

export function readRuntimeApiCredentials(input: unknown): RuntimeApiCredentials {
  const defaults = getRuntimeApiDefaults();
  const object =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const providerName =
    typeof object.providerName === "string" && object.providerName.trim()
      ? object.providerName.trim().slice(0, 80)
      : defaults.providerName;
  const baseUrl = normalizeBaseUrl(object.baseUrl);
  const effectiveBaseUrl =
    baseUrl || (hasOwn(object, "baseUrl") ? "" : defaults.baseUrl);
  const apiKeySource = normalizeApiKeySource(object.apiKeySource);
  const apiKeyEnvironmentName = getApiKeyEnvironmentName(
    providerName,
    effectiveBaseUrl,
    hasOwn(object, "providerId") ? object.providerId : defaults.providerId
  );
  const apiKey =
    apiKeySource === "environment"
      ? process.env[apiKeyEnvironmentName]?.trim() ?? ""
      : typeof object.apiKey === "string"
        ? object.apiKey.trim()
        : "";

  return {
    providerName,
    baseUrl: effectiveBaseUrl,
    apiKeySource,
    apiKeyEnvironmentName,
    apiKey
  };
}
