import { useCallback, useMemo } from "react";
import {
  getSelectableModelOptions,
  normalizeApiSettings,
  normalizeUiComplexity,
  type ApiSettings,
  type ReasoningEffort
} from "../../core/apiSettings";
import type { ChatSession } from "../../domain/chat/sessionModel";

export type SessionRunSettings = {
  model: string;
  reasoningEffort: ReasoningEffort;
  uiComplexity: number;
  selectableModels: string[];
};

export function deriveSessionRunSettings(
  session: ChatSession | undefined,
  apiSettings: ApiSettings
): SessionRunSettings {
  const model = session?.model || apiSettings.model;
  return {
    model,
    reasoningEffort:
      session?.reasoningEffort ?? apiSettings.reasoningEffort,
    uiComplexity: normalizeUiComplexity(
      session?.uiComplexity ?? apiSettings.uiComplexity
    ),
    selectableModels: getSelectableModelOptions(
      normalizeApiSettings({ ...apiSettings, model })
    )
  };
}

export function normalizeRequestedSessionModel(model: string): string | null {
  const normalized = model.trim();
  return normalized || null;
}

export type UseSessionRunSettingsInput = {
  session: ChatSession | undefined;
  apiSettings: ApiSettings;
  updateApiSettings(updater: (current: ApiSettings) => ApiSettings): void;
  updateActiveSession(updater: (session: ChatSession) => ChatSession): void;
};

export function useSessionRunSettings({
  session,
  apiSettings,
  updateApiSettings,
  updateActiveSession
}: UseSessionRunSettingsInput) {
  const settings = useMemo(
    () => deriveSessionRunSettings(session, apiSettings),
    [
      apiSettings,
      session?.model,
      session?.reasoningEffort,
      session?.uiComplexity
    ]
  );

  const changeModel = useCallback(
    (model: string) => {
      const nextModel = normalizeRequestedSessionModel(model);
      if (!nextModel) {
        return;
      }

      updateApiSettings((current) =>
        normalizeApiSettings({ ...current, model: nextModel })
      );
      updateActiveSession((current) => ({ ...current, model: nextModel }));
    },
    [updateActiveSession, updateApiSettings]
  );

  const changeReasoningEffort = useCallback(
    (reasoningEffort: ReasoningEffort) => {
      updateApiSettings((current) =>
        normalizeApiSettings({ ...current, reasoningEffort })
      );
      updateActiveSession((current) => ({ ...current, reasoningEffort }));
    },
    [updateActiveSession, updateApiSettings]
  );

  const changeUiComplexity = useCallback(
    (uiComplexity: number) => {
      const normalizedUiComplexity = normalizeUiComplexity(uiComplexity);
      updateApiSettings((current) =>
        normalizeApiSettings({
          ...current,
          uiComplexity: normalizedUiComplexity
        })
      );
      updateActiveSession((current) => ({
        ...current,
        uiComplexity: normalizedUiComplexity
      }));
    },
    [updateActiveSession, updateApiSettings]
  );

  return {
    ...settings,
    changeModel,
    changeReasoningEffort,
    changeUiComplexity
  };
}
