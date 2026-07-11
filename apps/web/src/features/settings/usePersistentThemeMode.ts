import { useEffect, useState } from "react";
import type { PageThemeMode } from "../../runtime/streamui/types";

const THEME_STORAGE_KEY = "streamui.theme.v1";

export function loadThemeMode(): PageThemeMode {
  if (typeof window === "undefined") {
    return "night";
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) === "day"
    ? "day"
    : "night";
}

export function usePersistentThemeMode() {
  const [themeMode, setThemeMode] =
    useState<PageThemeMode>(loadThemeMode);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  return [themeMode, setThemeMode] as const;
}
