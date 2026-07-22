const POP_ART_ONBOARDING_PREFIX = "chathtml.popArtOnboarding.v1:";

export const POP_ART_STYLE_PREFERENCE = "- In Pop Art style";

export type PopArtOnboardingStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function browserStorage(): PopArtOnboardingStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function onboardingKey(userId: string): string {
  return `${POP_ART_ONBOARDING_PREFIX}${userId}`;
}

export function hasCompletedPopArtOnboarding(
  userId: string,
  storage: PopArtOnboardingStorage | undefined = browserStorage()
): boolean {
  try {
    return storage?.getItem(onboardingKey(userId)) === "completed";
  } catch {
    return false;
  }
}

export function completePopArtOnboarding(
  userId: string,
  storage: PopArtOnboardingStorage | undefined = browserStorage()
): void {
  try {
    storage?.setItem(onboardingKey(userId), "completed");
  } catch {
    // The in-memory guard prevents the dialog reopening in this app session.
  }
}

export function addPopArtStylePreference(prompt: string): string {
  const alreadyIncluded = prompt
    .split(/\r?\n/)
    .some(
      (line) =>
        line.trim().toLowerCase() ===
        POP_ART_STYLE_PREFERENCE.toLowerCase()
    );
  if (alreadyIncluded) {
    return prompt;
  }

  const current = prompt.trimEnd();
  return current
    ? `${current}\n${POP_ART_STYLE_PREFERENCE}`
    : POP_ART_STYLE_PREFERENCE;
}
