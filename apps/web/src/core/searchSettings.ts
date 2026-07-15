import type { ApiKeySource } from "./apiSettings";

export type SearchProvider =
  | "auto"
  | "brave"
  | "tavily"
  | "serper"
  | "duckduckgo"
  | "none";

export type SearchBrowserEngine = "fetch" | "playwright";

export type SearchSettings = {
  enabled: boolean;
  provider: SearchProvider;
  apiKeySource: ApiKeySource;
  apiKey: string;
  allowDuckDuckGoFallback: boolean;
  browserEngine: SearchBrowserEngine;
  maxResults: number;
  fetchMaxPages: number;
};

export const SEARCH_SETTINGS_STORAGE_KEY = "streamui.searchSettings.v1";
const SEARCH_API_KEY_SESSION_STORAGE_KEY =
  "chathtml.searchApiKey.session.v1";

export const SEARCH_PROVIDER_OPTIONS: Array<{
  value: SearchProvider;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "brave", label: "Brave" },
  { value: "tavily", label: "Tavily" },
  { value: "serper", label: "Serper" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "none", label: "No search" }
];

export const SEARCH_BROWSER_ENGINE_OPTIONS: Array<{
  value: SearchBrowserEngine;
  label: string;
}> = [
  { value: "fetch", label: "Fetch" },
  { value: "playwright", label: "Playwright" }
];

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  enabled: true,
  provider: "auto",
  apiKeySource: "environment",
  apiKey: "",
  allowDuckDuckGoFallback: true,
  browserEngine: "fetch",
  maxResults: 5,
  fetchMaxPages: 4
};

function isSearchProvider(value: unknown): value is SearchProvider {
  return SEARCH_PROVIDER_OPTIONS.some((option) => option.value === value);
}

function isBrowserEngine(value: unknown): value is SearchBrowserEngine {
  return SEARCH_BROWSER_ENGINE_OPTIONS.some((option) => option.value === value);
}

function isApiKeySource(value: unknown): value is ApiKeySource {
  return value === "environment" || value === "manual";
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.round(Math.min(max, Math.max(min, parsed)));
}

export function searchProviderNeedsApiKey(provider: SearchProvider): boolean {
  return provider === "brave" || provider === "tavily" || provider === "serper";
}

export function getSearchProviderApiKeyEnvironmentName(
  settings: SearchSettings
): string {
  const normalized = normalizeSearchSettings(settings);

  if (normalized.provider === "brave") {
    return "BRAVE_SEARCH_API_KEY";
  }
  if (normalized.provider === "tavily") {
    return "TAVILY_API_KEY";
  }
  if (normalized.provider === "serper") {
    return "SERPER_API_KEY";
  }
  if (normalized.provider === "auto") {
    return "BRAVE_SEARCH_API_KEY / TAVILY_API_KEY / SERPER_API_KEY";
  }

  return "";
}

export function normalizeSearchSettings(input: unknown): SearchSettings {
  const object =
    typeof input === "object" && input !== null
      ? (input as Partial<SearchSettings>)
      : {};
  const provider = isSearchProvider(object.provider)
    ? object.provider
    : DEFAULT_SEARCH_SETTINGS.provider;

  return {
    enabled:
      typeof object.enabled === "boolean"
        ? object.enabled
        : DEFAULT_SEARCH_SETTINGS.enabled,
    provider,
    apiKeySource: isApiKeySource(object.apiKeySource)
      ? object.apiKeySource
      : DEFAULT_SEARCH_SETTINGS.apiKeySource,
    apiKey: typeof object.apiKey === "string" ? object.apiKey.trim() : "",
    allowDuckDuckGoFallback:
      typeof object.allowDuckDuckGoFallback === "boolean"
        ? object.allowDuckDuckGoFallback
        : DEFAULT_SEARCH_SETTINGS.allowDuckDuckGoFallback,
    browserEngine: isBrowserEngine(object.browserEngine)
      ? object.browserEngine
      : DEFAULT_SEARCH_SETTINGS.browserEngine,
    maxResults: clampInteger(
      object.maxResults,
      DEFAULT_SEARCH_SETTINGS.maxResults,
      1,
      10
    ),
    fetchMaxPages: clampInteger(
      object.fetchMaxPages,
      DEFAULT_SEARCH_SETTINGS.fetchMaxPages,
      0,
      10
    )
  };
}

export function loadSearchSettings(): SearchSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SEARCH_SETTINGS;
  }

  try {
    const persisted = normalizeSearchSettings(
      JSON.parse(window.localStorage.getItem(SEARCH_SETTINGS_STORAGE_KEY) ?? "null")
    );
    const sessionKey =
      window.sessionStorage.getItem(SEARCH_API_KEY_SESSION_STORAGE_KEY) ??
      (persisted.apiKeySource === "manual" ? persisted.apiKey : "");
    if (persisted.apiKey) {
      if (persisted.apiKeySource === "manual" && sessionKey) {
        window.sessionStorage.setItem(
          SEARCH_API_KEY_SESSION_STORAGE_KEY,
          sessionKey
        );
      }
      window.localStorage.setItem(
        SEARCH_SETTINGS_STORAGE_KEY,
        JSON.stringify({ ...persisted, apiKey: "" })
      );
    }
    return normalizeSearchSettings({ ...persisted, apiKey: sessionKey });
  } catch {
    return DEFAULT_SEARCH_SETTINGS;
  }
}

export function saveSearchSettings(settings: SearchSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeSearchSettings(settings);
  window.localStorage.setItem(
    SEARCH_SETTINGS_STORAGE_KEY,
    JSON.stringify({ ...normalized, apiKey: "" })
  );
  if (normalized.apiKeySource === "manual" && normalized.apiKey) {
    window.sessionStorage.setItem(
      SEARCH_API_KEY_SESSION_STORAGE_KEY,
      normalized.apiKey
    );
  } else {
    window.sessionStorage.removeItem(SEARCH_API_KEY_SESSION_STORAGE_KEY);
  }
}

export function serializeSearchSettings(settings: SearchSettings): SearchSettings {
  const normalized = normalizeSearchSettings(settings);
  return {
    ...normalized,
    apiKey:
      normalized.apiKeySource === "manual" &&
      searchProviderNeedsApiKey(normalized.provider)
        ? normalized.apiKey
        : ""
  };
}
