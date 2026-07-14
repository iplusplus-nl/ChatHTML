import type { PageThemeMode } from "./types";
import { buildSandboxRuntimeSource } from "./sandboxRuntime";
import { buildSandboxStyles } from "./sandboxStyles";

const CSP = [
  "default-src 'none'",
  "img-src 'self' https: http://127.0.0.1:* http://localhost:* data: blob:",
  "style-src 'unsafe-inline' https:",
  "script-src 'unsafe-inline' https:",
  "font-src https: data:",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
  "media-src 'self' https: http://127.0.0.1:* http://localhost:* data: blob:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

const MATHJAX_SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";

export type IframeThemeTokens = {
  mode: PageThemeMode;
  colorScheme: "light" | "dark";
  pageBg: string;
  text: string;
  muted: string;
  link: string;
  buttonBg: string;
  buttonText: string;
  secondaryBorder: string;
  secondaryText: string;
};

export function getIframeThemeTokens(themeMode: PageThemeMode): IframeThemeTokens {
  if (themeMode === "day") {
    return {
      mode: "day",
      colorScheme: "light",
      pageBg: "#ffffff",
      text: "#18181b",
      muted: "#71717a",
      link: "#18181b",
      buttonBg: "#18181b",
      buttonText: "#ffffff",
      secondaryBorder: "#d4d4d8",
      secondaryText: "#3f3f46"
    };
  }

  return {
    mode: "night",
    colorScheme: "dark",
    pageBg: "#212121",
    text: "#f4f4f5",
    muted: "#a1a1aa",
    link: "#ffffff",
    buttonBg: "#f4f4f5",
    buttonText: "#18181b",
    secondaryBorder: "rgba(255, 255, 255, 0.18)",
    secondaryText: "#e4e4e7"
  };
}

export function applyIframeTheme(document: Document, themeMode: PageThemeMode): void {
  const theme = getIframeThemeTokens(themeMode);
  const root = document.documentElement;

  root.dataset.pageTheme = theme.mode;
  root.style.setProperty("color-scheme", theme.colorScheme);
  root.style.setProperty("--streamui-page-bg", theme.pageBg);
  root.style.setProperty("--streamui-text", theme.text);
  root.style.setProperty("--streamui-muted", theme.muted);
  root.style.setProperty("--streamui-link", theme.link);
  root.style.setProperty("--streamui-button-bg", theme.buttonBg);
  root.style.setProperty("--streamui-button-text", theme.buttonText);
  root.style.setProperty("--streamui-secondary-border", theme.secondaryBorder);
  root.style.setProperty("--streamui-secondary-text", theme.secondaryText);
}

export function buildIframeBodyHtml(completedHtml: string): string {
  return `${completedHtml}
<style id="streamui-performance-guard">
  *, *::before, *::after {
    background-attachment: scroll !important;
  }
</style>`;
}

export function buildIframeDocument(
  completedHtml: string,
  themeMode: PageThemeMode = "night",
  actionsEnabled = true,
  hostChannelToken = "",
  hostDocumentEpoch = ""
): string {
  const theme = getIframeThemeTokens(themeMode);

  return `<!doctype html>
<html lang="en" data-page-theme="${theme.mode}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <style>
${buildSandboxStyles(theme)}  </style>
  <script>
${buildSandboxRuntimeSource(
  MATHJAX_SCRIPT_SRC,
  hostChannelToken,
  hostDocumentEpoch
)}  </script>
  <script>
    document.currentScript?.previousElementSibling?.remove();
  </script>
</head>
<body data-streamui-actions-enabled="${actionsEnabled ? "true" : "false"}">
${buildIframeBodyHtml(completedHtml)}
</body>
</html>`;
}
