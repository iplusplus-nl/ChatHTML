import { X } from "lucide-react";
import {
  API_KEY_SOURCE_OPTIONS,
  API_PROVIDER_PRESETS,
  UI_COMPLEXITY_LEVEL_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  getApiKeyEnvironmentName,
  getDefaultModelsEndpoint,
  getSelectableModelOptions,
  getUiComplexityLevel,
  isRequiredModelOption,
  normalizeUiComplexity,
  type ApiKeySource,
  type ApiProviderId,
  type ApiSettings,
  type ReasoningEffort
} from "../../core/apiSettings";
import {
  getEnvironmentKeyStatus,
  type EnvironmentKeyStatus,
  type RuntimeSettingsSummary
} from "../../core/runtimeSettings";

function formatEnvironmentStatus(
  name: string,
  status: EnvironmentKeyStatus | null
): string {
  if (!status) {
    return `${name}: checking`;
  }

  return `${name}: ${status.configured ? "set" : "missing"}`;
}

function getEnvironmentStatusClass(status: EnvironmentKeyStatus | null): string {
  if (!status) {
    return "is-pending";
  }

  return status.configured ? "is-configured" : "is-missing";
}

type ApiSettingsSectionProps = {
  settings: ApiSettings;
  runtimeSettings: RuntimeSettingsSummary | null;
  cloudEnabled: boolean;
  isModelImportLoading: boolean;
  onSettingsChange(patch: Partial<ApiSettings>): void;
  onProviderChange(providerId: ApiProviderId): void;
  onBaseUrlChange(baseUrl: string): void;
  onFetchModels(): void;
  onRemoveModel(modelId: string): void;
};

export function ApiSettingsSection({
  settings,
  runtimeSettings,
  cloudEnabled,
  isModelImportLoading,
  onSettingsChange,
  onProviderChange,
  onBaseUrlChange,
  onFetchModels,
  onRemoveModel
}: ApiSettingsSectionProps) {
  const apiKeyStatus = getEnvironmentKeyStatus(
    runtimeSettings?.api.environmentKeys,
    getApiKeyEnvironmentName(settings)
  );
  const usesRuntimeKey =
    settings.apiKeySource === "environment" ||
    settings.apiKeySource === "managed";
  const isManagedProvider = settings.apiKeySource === "managed";
  const apiKeySourceOptions = isManagedProvider
    ? [{ value: "managed" as ApiKeySource, label: "Managed by ChatHTML Cloud" }]
    : API_KEY_SOURCE_OPTIONS;
  const providerPresets = API_PROVIDER_PRESETS.filter(
    (preset) =>
      preset.apiKeySource !== "managed" ||
      cloudEnabled ||
      preset.id === settings.providerId
  );
  const selectableModels = getSelectableModelOptions(settings);

  return (
    <>
      <label className="settings-row">
        <span>Provider</span>
        <select
          value={settings.providerId}
          onChange={(event) =>
            onProviderChange(event.target.value as ApiProviderId)
          }
        >
          {providerPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <span>Base URL</span>
        <input
          value={settings.baseUrl}
          autoComplete="off"
          spellCheck={false}
          disabled={isManagedProvider}
          placeholder="https://api.example.com/v1"
          onChange={(event) => onBaseUrlChange(event.target.value)}
        />
      </label>

      <label className="settings-row">
        <span>API Key Source</span>
        <select
          value={settings.apiKeySource}
          disabled={isManagedProvider}
          onChange={(event) =>
            onSettingsChange({ apiKeySource: event.target.value as ApiKeySource })
          }
        >
          {apiKeySourceOptions.map((option) => (
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
            disabled={settings.apiKeySource !== "manual"}
            spellCheck={false}
            type="password"
            placeholder={
              isManagedProvider
                ? "Managed by ChatHTML Cloud"
                : settings.apiKeySource === "environment"
                  ? getApiKeyEnvironmentName(settings)
                  : "sk-..."
            }
            onChange={(event) => onSettingsChange({ apiKey: event.target.value })}
          />
          {usesRuntimeKey ? (
            <span
              className={`settings-hint settings-env-status ${getEnvironmentStatusClass(
                apiKeyStatus
              )}`}
            >
              {formatEnvironmentStatus(
                getApiKeyEnvironmentName(settings),
                apiKeyStatus
              )}
            </span>
          ) : null}
        </div>
      </label>

      <label className="settings-row">
        <span>Default Model</span>
        <div className="settings-control-stack">
          <select
            value={settings.model}
            onChange={(event) => onSettingsChange({ model: event.target.value })}
          >
            {selectableModels.length ? (
              selectableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            ) : (
              <option value="">No saved models</option>
            )}
          </select>
        </div>
      </label>

      <label className="settings-row">
        <span>Models Endpoint</span>
        <div className="settings-inline-control">
          <input
            value={settings.modelsEndpoint}
            autoComplete="off"
            spellCheck={false}
            disabled={isManagedProvider}
            placeholder={
              getDefaultModelsEndpoint(settings.baseUrl) ||
              "https://api.example.com/v1/models"
            }
            onChange={(event) =>
              onSettingsChange({ modelsEndpoint: event.target.value })
            }
          />
          <button
            className="settings-small-button"
            type="button"
            disabled={isModelImportLoading}
            onClick={onFetchModels}
          >
            Fetch
          </button>
        </div>
      </label>

      <div className="settings-row settings-row-textarea">
        <span>Model List</span>
        <div className="settings-model-list">
          {settings.modelOptions.length ? (
            settings.modelOptions.map((model) => {
              const isRequiredModel = isRequiredModelOption(model);

              return (
                <span
                  key={model}
                  className={`settings-model-chip ${
                    model === settings.model ? "is-active" : ""
                  } ${isRequiredModel ? "is-locked" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onSettingsChange({ model })}
                  >
                    {model}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      isRequiredModel
                        ? `${model} is always included`
                        : `Remove ${model}`
                    }
                    disabled={isRequiredModel}
                    title={isRequiredModel ? "Always included" : undefined}
                    onClick={() => onRemoveModel(model)}
                  >
                    <X size={13} strokeWidth={2.1} aria-hidden="true" />
                  </button>
                </span>
              );
            })
          ) : (
            <span className="settings-empty-state">No saved models</span>
          )}
        </div>
      </div>

      <label className="settings-row">
        <span>Reasoning</span>
        <select
          value={settings.reasoningEffort}
          onChange={(event) =>
            onSettingsChange({
              reasoningEffort: event.target.value as ReasoningEffort
            })
          }
        >
          {REASONING_EFFORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <span>UI complexity</span>
        <select
          value={getUiComplexityLevel(settings.uiComplexity).value}
          onChange={(event) =>
            onSettingsChange({
              uiComplexity: normalizeUiComplexity(event.target.value)
            })
          }
        >
          {UI_COMPLEXITY_LEVEL_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
