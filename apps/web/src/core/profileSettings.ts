export type ProfileSettings = {
  avatarDataUrl: string;
};

export const PROFILE_SETTINGS_STORAGE_KEY = "streamui.profileSettings.v1";

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  avatarDataUrl: ""
};

const AVATAR_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,/i;

export function normalizeProfileSettings(input: unknown): ProfileSettings {
  const object =
    typeof input === "object" && input !== null
      ? (input as Partial<ProfileSettings>)
      : {};
  const avatarDataUrl =
    typeof object.avatarDataUrl === "string" &&
    AVATAR_DATA_URL_PATTERN.test(object.avatarDataUrl)
      ? object.avatarDataUrl
      : "";

  return { avatarDataUrl };
}

export function loadProfileSettings(): ProfileSettings {
  if (typeof window === "undefined") {
    return DEFAULT_PROFILE_SETTINGS;
  }

  try {
    return normalizeProfileSettings(
      JSON.parse(
        window.localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY) ?? "null"
      )
    );
  } catch {
    return DEFAULT_PROFILE_SETTINGS;
  }
}

export function saveProfileSettings(settings: ProfileSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    PROFILE_SETTINGS_STORAGE_KEY,
    JSON.stringify(normalizeProfileSettings(settings))
  );
}
