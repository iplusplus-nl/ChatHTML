import {
  getDefaultModelsEndpoint,
  getProviderPreset,
  isRequiredModelOption,
  normalizeApiSettings,
  normalizeMemoryItems,
  type ApiProviderId,
  type ApiSettings
} from "../../core/apiSettings";

export type ExportedUserPreferences = {
  userPreferencePrompt: string;
  memoryItems: ApiSettings["memoryItems"];
};

export function changeSettingsBaseUrl(
  current: ApiSettings,
  baseUrl: string
): ApiSettings {
  const currentDefaultEndpoint = getDefaultModelsEndpoint(current.baseUrl);
  const shouldFollowBaseUrl =
    !current.modelsEndpoint || current.modelsEndpoint === currentDefaultEndpoint;

  return normalizeApiSettings({
    ...current,
    baseUrl,
    modelsEndpoint: shouldFollowBaseUrl
      ? getDefaultModelsEndpoint(baseUrl)
      : current.modelsEndpoint
  });
}

export function changeSettingsProvider(
  current: ApiSettings,
  providerId: ApiProviderId
): ApiSettings {
  const preset = getProviderPreset(providerId);

  return normalizeApiSettings({
    ...current,
    providerId: preset.id,
    providerName: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    modelOptions: [preset.model],
    modelsEndpoint: getDefaultModelsEndpoint(preset.baseUrl),
    reasoningEffort: preset.reasoningEffort,
    apiKeySource: preset.apiKeySource ?? current.apiKeySource,
    apiKey: preset.apiKeySource === "managed" ? "" : current.apiKey
  });
}

export function toggleSettingsModelSelection(
  current: string[],
  modelId: string
): string[] {
  if (isRequiredModelOption(modelId)) {
    return current;
  }

  const normalizedModelId = modelId.toLowerCase();
  const exists = current.some(
    (selectedModel) => selectedModel.toLowerCase() === normalizedModelId
  );

  return exists
    ? current.filter(
        (selectedModel) => selectedModel.toLowerCase() !== normalizedModelId
      )
    : [...current, modelId];
}

export function addSettingsModelOptions(
  current: ApiSettings,
  selectedModels: string[]
): ApiSettings {
  if (!selectedModels.length) {
    return current;
  }

  return normalizeApiSettings({
    ...current,
    model: current.model || selectedModels[0],
    modelOptions: [...current.modelOptions, ...selectedModels]
  });
}

export function removeSettingsModelOption(
  current: ApiSettings,
  modelId: string
): ApiSettings {
  if (isRequiredModelOption(modelId)) {
    return current;
  }

  const modelOptions = current.modelOptions.filter(
    (modelOption) => modelOption !== modelId
  );

  return normalizeApiSettings({
    ...current,
    model: current.model === modelId ? (modelOptions[0] ?? "") : current.model,
    modelOptions
  });
}

export function getExportedUserPreferences(
  settings: ApiSettings
): ExportedUserPreferences {
  return {
    userPreferencePrompt: settings.userPreferencePrompt.trim(),
    memoryItems: normalizeMemoryItems(settings.memoryItems)
  };
}

export function applyImportedUserPreferences(
  current: ApiSettings,
  imported: unknown
): ApiSettings {
  const normalized = normalizeApiSettings(imported);

  return {
    ...current,
    userPreferencePrompt: normalized.userPreferencePrompt,
    memoryItems: normalized.memoryItems
  };
}
