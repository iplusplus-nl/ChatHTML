import type { ApiSettings } from "./apiSettings";

export type EnvironmentKeyStatus = {
  name: string;
  configured: boolean;
};

export type RuntimeSettingsSummary = {
  api: {
    defaults: ApiSettings;
    environmentKeys: EnvironmentKeyStatus[];
  };
  search: {
    environmentKeys: EnvironmentKeyStatus[];
  };
};

export function getEnvironmentKeyStatus(
  keys: EnvironmentKeyStatus[] | undefined,
  name: string
): EnvironmentKeyStatus | null {
  return keys?.find((key) => key.name === name) ?? null;
}

export async function loadRuntimeSettings(): Promise<RuntimeSettingsSummary> {
  const response = await fetch("/api/settings");

  if (!response.ok) {
    throw new Error(`Settings load failed with HTTP ${response.status}.`);
  }

  return response.json() as Promise<RuntimeSettingsSummary>;
}
