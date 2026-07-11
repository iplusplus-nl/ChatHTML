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
import { SettingsSelect } from "./SettingsSelect";

const PROVIDER_DESCRIPTIONS: Record<ApiProviderId, string> = {
  openrouter: "Use your own OpenRouter API key",
  "chathtml-cloud": "Managed by ChatHTML · sign-in required",
  openai: "Connect directly with an OpenAI API key",
  local: "Use an OpenAI-compatible service on this device",
  custom: "Connect any OpenAI-compatible endpoint"
};

const REASONING_DESCRIPTIONS: Partial<Record<ReasoningEffort, string>> = {
  none: "Fastest, without a reasoning budget",
  low: "A short reasoning pass",
  medium: "Balanced depth and response time",
  high: "More time for difficult tasks",
  xhigh: "Maximum available reasoning effort"
};

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
      <div className="settings-row">
        <span>Provider</span>
        <SettingsSelect
          ariaLabel="Provider"
          value={settings.providerId}
          options={providerPresets.map((preset) => ({
            value: preset.id,
            label: preset.label,
            description: PROVIDER_DESCRIPTIONS[preset.id]
          }))}
          onChange={(value) => onProviderChange(value as ApiProviderId)}
        />
      </div>

      {isManagedProvider ? (
        <div className="settings-row">
          <span>Connection</span>
          <span className="settings-hint">
            Managed securely by the ChatHTML server
          </span>
        </div>
      ) : (
        <>
          <label className="settings-row">
            <span>Base URL</span>
            <input
              value={settings.baseUrl}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              onChange={(event) => onBaseUrlChange(event.target.value)}
            />
          </label>

          <div className="settings-row">
            <span>API Key Source</span>
            <SettingsSelect
              ariaLabel="API Key Source"
              value={settings.apiKeySource}
              options={apiKeySourceOptions.map((option) => ({
                ...option,
                description:
                  option.value === "manual"
                    ? "Store a provider key in this browser"
                    : option.value === "environment"
                      ? "Read the key from the ChatHTML server"
                      : "Use the authenticated managed service"
              }))}
              onChange={(value) =>
                onSettingsChange({ apiKeySource: value as ApiKeySource })
              }
            />
          </div>

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
                  settings.apiKeySource === "environment"
                    ? getApiKeyEnvironmentName(settings)
                    : "sk-..."
                }
                onChange={(event) =>
                  onSettingsChange({ apiKey: event.target.value })
                }
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
        </>
      )}

      <div className="settings-row">
        <span>Default Model</span>
        <div className="settings-control-stack">
          <SettingsSelect
            ariaLabel="Default Model"
            value={settings.model}
            options={
              selectableModels.length
                ? selectableModels.map((model) => ({
                    value: model,
                    label: model
                  }))
                : [{ value: "", label: "No saved models", disabled: true }]
            }
            onChange={(model) => onSettingsChange({ model })}
          />
        </div>
      </div>

      {!isManagedProvider ? (
        <label className="settings-row">
          <span>Models Endpoint</span>
          <div className="settings-inline-control">
            <input
              value={settings.modelsEndpoint}
              autoComplete="off"
              spellCheck={false}
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
      ) : null}

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

      <div className="settings-row">
        <span>Reasoning</span>
        <SettingsSelect
          ariaLabel="Reasoning"
          value={settings.reasoningEffort}
          options={REASONING_EFFORT_OPTIONS.map((option) => ({
            ...option,
            description: REASONING_DESCRIPTIONS[option.value]
          }))}
          onChange={(value) =>
            onSettingsChange({ reasoningEffort: value as ReasoningEffort })
          }
        />
      </div>

      <div className="settings-row">
        <span>UI complexity</span>
        <SettingsSelect
          ariaLabel="UI complexity"
          value={String(getUiComplexityLevel(settings.uiComplexity).value)}
          options={UI_COMPLEXITY_LEVEL_OPTIONS.map((option) => ({
            value: String(option.value),
            label: option.label,
            description:
              option.value < 50
                ? "Cleaner, simpler generated interfaces"
                : option.value > 50
                  ? "Richer layouts and visual detail"
                  : "Balanced structure and visual detail"
          }))}
          onChange={(value) =>
            onSettingsChange({ uiComplexity: normalizeUiComplexity(value) })
          }
        />
      </div>
    </>
  );
}
