import type { StreamUiAction } from "../../runtime/streamui/types";

export type PreviewCapabilityAction =
  | Extract<StreamUiAction, { type: "copy" }>
  | Extract<StreamUiAction, { type: "download" }>
  | Extract<StreamUiAction, { type: "open-url" }>;

const MAX_CAPABILITY_TEXT_CHARS = 1_000_000;

export function normalizeCapabilityText(value: unknown): string {
  return String(value ?? "").slice(0, MAX_CAPABILITY_TEXT_CHARS);
}

export function normalizeCapabilityLabel(value: unknown): string | undefined {
  const label = String(value ?? "").trim().slice(0, 200);
  return label || undefined;
}

export function sanitizeDownloadFilename(value: unknown): string {
  const filename = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return filename || "chathtml-export.txt";
}

export function sanitizeMimeType(value: unknown): string {
  const mimeType = String(value ?? "").trim().slice(0, 120);
  return mimeType || "text/plain;charset=utf-8";
}

export function normalizeOpenUrl(value: unknown, baseUrl: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error("No URL was provided.");
  }

  const url = new URL(raw, baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs can be opened.");
  }

  return url.href;
}

export function getCapabilityTitle(action: PreviewCapabilityAction): string {
  if (action.type === "copy") {
    return "Copy from artifact";
  }
  if (action.type === "download") {
    return "Download from artifact";
  }
  return "Open link from artifact";
}

export function getCapabilityConfirmLabel(
  action: PreviewCapabilityAction
): string {
  if (action.type === "copy") {
    return "Copy";
  }
  if (action.type === "download") {
    return "Download";
  }
  return "Open";
}

export function getCapabilityPreview(action: PreviewCapabilityAction): string {
  return action.type === "open-url" ? action.url : action.text;
}
