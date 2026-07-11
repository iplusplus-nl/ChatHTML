import {
  API_KEY_SOURCE_OPTIONS,
  type ApiKeySource
} from "../../core/apiSettings";
import {
  SEARCH_BROWSER_ENGINE_OPTIONS,
  SEARCH_PROVIDER_OPTIONS,
  getSearchProviderApiKeyEnvironmentName,
  searchProviderNeedsApiKey,
  type SearchBrowserEngine,
  type SearchProvider,
  type SearchSettings
} from "../../core/searchSettings";
import {
  getEnvironmentKeyStatus,
  type EnvironmentKeyStatus,
  type RuntimeSearchBrowserStatus,
  type RuntimeSearchProviderStatus,
  type RuntimeSettingsSummary
} from "../../core/runtimeSettings";

function getSearchEnvironmentKeyNames(provider: SearchProvider): string[] {
  if (provider === "auto") {
    return ["BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY", "SERPER_API_KEY"];
  }
  if (provider === "brave") {
    return ["BRAVE_SEARCH_API_KEY"];
  }
  if (provider === "tavily") {
    return ["TAVILY_API_KEY"];
  }
  if (provider === "serper") {
    return ["SERPER_API_KEY"];
  }

  return [];
}

function formatEnvironmentStatus(
  name: string,
  status: EnvironmentKeyStatus | null
): string {
  if (!status) {
    return `${name}: checking`;
  }

  return `${name}: ${status.configured ? "set" : "missing"}`;
}

function getSearchProviderCapability(
  runtimeSettings: RuntimeSettingsSummary | null,
  provider: SearchProvider
): RuntimeSearchProviderStatus | null {
  if (provider === "auto" || provider === "none") {
    return null;
  }

  return (
    runtimeSettings?.search.providers.find((status) => status.provider === provider) ??
    null
  );
}

function getSearchBrowserCapability(
  runtimeSettings: RuntimeSettingsSummary | null,
  engine: SearchBrowserEngine
): RuntimeSearchBrowserStatus | null {
  return (
    runtimeSettings?.search.browserEngines.find(
      (status) => status.engine === engine
    ) ?? null
  );
}

function formatSearchProviderCapability(
  provider: RuntimeSearchProviderStatus
): string {
  if (!provider.requiresApiKey) {
    return `${provider.label}: no key required`;
  }

  return `${provider.label}: ${
    provider.configured ? "env key set" : "env key missing"
  }`;
}

function getSearchCapabilityClass(configured: boolean): string {
  return configured ? "is-configured" : "is-missing";
}

type SearchSettingsSectionProps = {
  settings: SearchSettings;
  runtimeSettings: RuntimeSettingsSummary | null;
  onSettingsChange(patch: Partial<SearchSettings>): void;
};

export function SearchSettingsSection({
  settings,
  runtimeSettings,
  onSettingsChange
}: SearchSettingsSectionProps) {
  const allowsManualKey = searchProviderNeedsApiKey(settings.provider);
  const usesEnvironmentKeys =
    settings.provider === "auto" || allowsManualKey;
  const keyStatuses = getSearchEnvironmentKeyNames(settings.provider).map(
    (name) => ({
      name,
      status: getEnvironmentKeyStatus(
        runtimeSettings?.search.environmentKeys,
        name
      )
    })
  );
  const selectedProviderCapability = getSearchProviderCapability(
    runtimeSettings,
    settings.provider
  );
  const selectedBrowserCapability = getSearchBrowserCapability(
    runtimeSettings,
    settings.browserEngine
  );

  return (
    <>
      <label className="settings-row">
        <span>Retrieval</span>
        <input
          className="settings-checkbox"
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) =>
            onSettingsChange({ enabled: event.target.checked })
          }
        />
      </label>

      <div className="settings-row settings-row-textarea">
        <span>Capability Status</span>
        <div className="settings-capability-list">
          {runtimeSettings ? (
            <>
              <span className="settings-capability-chip is-neutral">
                Provider default: {runtimeSettings.search.defaultProvider}
              </span>
              {runtimeSettings.search.providers.map((provider) => (
                <span
                  className={`settings-capability-chip ${getSearchCapabilityClass(
                    provider.configured
                  )}`}
                  key={provider.provider}
                >
                  {formatSearchProviderCapability(provider)}
                </span>
              ))}
              {runtimeSettings.search.browserEngines.map((engine) => (
                <span
                  className={`settings-capability-chip ${
                    engine.available ? "is-configured" : "is-missing"
                  }`}
                  key={engine.engine}
                >
                  {engine.label}: {engine.available ? "available" : "not installed"}
                  {engine.activeByDefault ? " default" : ""}
                </span>
              ))}
            </>
          ) : (
            <span className="settings-empty-state">Checking runtime</span>
          )}
        </div>
      </div>

      <label className="settings-row">
        <span>Provider</span>
        <div className="settings-control-stack">
          <select
            value={settings.provider}
            onChange={(event) => {
              const provider = event.target.value as SearchProvider;
              onSettingsChange({
                provider,
                apiKeySource: searchProviderNeedsApiKey(provider)
                  ? settings.apiKeySource
                  : "environment"
              });
            }}
          >
            {SEARCH_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {selectedProviderCapability &&
          settings.apiKeySource === "environment" ? (
            <span
              className={`settings-hint settings-env-status ${getSearchCapabilityClass(
                selectedProviderCapability.configured
              )}`}
            >
              {formatSearchProviderCapability(selectedProviderCapability)}
            </span>
          ) : null}
        </div>
      </label>

      <label className="settings-row">
        <span>API Key Source</span>
        <select
          value={settings.apiKeySource}
          disabled={!allowsManualKey}
          onChange={(event) =>
            onSettingsChange({ apiKeySource: event.target.value as ApiKeySource })
          }
        >
          {API_KEY_SOURCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <span>API Key</span>
        <div className="settings-control-stack">
          <input
            value={settings.apiKey}
            autoComplete="off"
            disabled={
              !allowsManualKey || settings.apiKeySource === "environment"
            }
            spellCheck={false}
            type="password"
            placeholder={
              usesEnvironmentKeys
                ? settings.apiKeySource === "environment"
                  ? getSearchProviderApiKeyEnvironmentName(settings)
                  : "search api key"
                : "Not required"
            }
            onChange={(event) =>
              onSettingsChange({ apiKey: event.target.value })
            }
          />
          {usesEnvironmentKeys &&
          settings.apiKeySource === "environment" &&
          getSearchProviderApiKeyEnvironmentName(settings) ? (
            <span className="settings-hint settings-env-list">
              {keyStatuses
                .map(({ name, status }) =>
                  formatEnvironmentStatus(name, status)
                )
                .join(" | ")}
            </span>
          ) : null}
          {allowsManualKey && settings.apiKeySource === "manual" ? (
            <span
              className={`settings-hint settings-env-status ${
                settings.apiKey.trim() ? "is-configured" : "is-missing"
              }`}
            >
              {settings.apiKey.trim()
                ? "Manual search key entered"
                : "Manual search key missing"}
            </span>
          ) : null}
        </div>
      </label>

      <label className="settings-row">
        <span>DuckDuckGo Fallback</span>
        <input
          className="settings-checkbox"
          type="checkbox"
          checked={settings.allowDuckDuckGoFallback}
          disabled={settings.provider !== "auto"}
          onChange={(event) =>
            onSettingsChange({
              allowDuckDuckGoFallback: event.target.checked
            })
          }
        />
      </label>

      <label className="settings-row">
        <span>Fetch Engine</span>
        <div className="settings-control-stack">
          <select
            value={settings.browserEngine}
            onChange={(event) =>
              onSettingsChange({
                browserEngine: event.target.value as SearchBrowserEngine
              })
            }
          >
            {SEARCH_BROWSER_ENGINE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {selectedBrowserCapability ? (
            <span
              className={`settings-hint settings-env-status ${
                selectedBrowserCapability.available
                  ? "is-configured"
                  : "is-missing"
              }`}
            >
              {selectedBrowserCapability.detail}
            </span>
          ) : null}
        </div>
      </label>

      <label className="settings-row">
        <span>Results</span>
        <input
          value={settings.maxResults}
          min={1}
          max={10}
          type="number"
          onChange={(event) =>
            onSettingsChange({
              maxResults: Number.parseInt(event.target.value, 10)
            })
          }
        />
      </label>

      <label className="settings-row">
        <span>Pages to Fetch</span>
        <input
          value={settings.fetchMaxPages}
          min={0}
          max={10}
          type="number"
          onChange={(event) =>
            onSettingsChange({
              fetchMaxPages: Number.parseInt(event.target.value, 10)
            })
          }
        />
      </label>
    </>
  );
}
