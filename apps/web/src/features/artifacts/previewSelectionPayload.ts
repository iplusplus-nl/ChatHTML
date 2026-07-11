import type { ArtifactSelectionPayload } from "../../core/artifactSelection";

export type PreviewSelectionTarget = Pick<
  ArtifactSelectionPayload,
  "key" | "kind" | "selector"
> &
  Partial<Pick<ArtifactSelectionPayload, "label" | "preview">>;

const MAX_SELECTION_KEY_CHARS = 700;
const MAX_SELECTION_SELECTOR_CHARS = 1200;
const MAX_SELECTION_LABEL_CHARS = 220;
const MAX_SELECTION_PREVIEW_CHARS = 420;
const MAX_SELECTION_TEXT_CHARS = 2200;
const MAX_SELECTION_HTML_CHARS = 12500;

function normalizeSelectionString(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function isDomLikeSelectionLabel(value: string): boolean {
  return /^[a-z][a-z0-9-]*(?:[#.:\[][^\s]*)?$/i.test(value);
}

function getSelectionPreviewFromHtml(html: string): string {
  if (!html || typeof document === "undefined") {
    return "";
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  template.content
    .querySelectorAll("script,style,template,noscript,[aria-hidden='true']")
    .forEach((element) => element.remove());

  const root = template.content.firstElementChild;
  if (!root) {
    return normalizeSelectionString(
      template.content.textContent,
      MAX_SELECTION_PREVIEW_CHARS
    );
  }

  const controlValue =
    root instanceof HTMLInputElement ||
    root instanceof HTMLTextAreaElement ||
    root instanceof HTMLSelectElement
      ? root.value
      : "";
  return (
    normalizeSelectionString(controlValue, MAX_SELECTION_PREVIEW_CHARS) ||
    normalizeSelectionString(
      root.getAttribute("aria-label"),
      MAX_SELECTION_PREVIEW_CHARS
    ) ||
    normalizeSelectionString(
      root.getAttribute("title"),
      MAX_SELECTION_PREVIEW_CHARS
    ) ||
    normalizeSelectionString(root.textContent, MAX_SELECTION_PREVIEW_CHARS)
  );
}

export function normalizeArtifactSelectionPayload(
  value: unknown
): ArtifactSelectionPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const kind =
    input.kind === "text"
      ? "text"
      : input.kind === "element"
        ? "element"
        : null;
  const key = normalizeSelectionString(input.key, MAX_SELECTION_KEY_CHARS);
  const selector = normalizeSelectionString(
    input.selector,
    MAX_SELECTION_SELECTOR_CHARS
  );
  if (!kind || !key || !selector) {
    return null;
  }

  const label =
    normalizeSelectionString(input.label, MAX_SELECTION_LABEL_CHARS) ||
    (kind === "text" ? "Selected text" : "Selected element");
  const tagName = normalizeSelectionString(input.tagName, 80).toLowerCase();
  const text = normalizeSelectionString(input.text, MAX_SELECTION_TEXT_CHARS);
  const html = String(input.html ?? "").slice(0, MAX_SELECTION_HTML_CHARS);
  const inputPreview = normalizeSelectionString(
    input.preview,
    MAX_SELECTION_PREVIEW_CHARS
  );
  const htmlPreview =
    kind === "element" &&
    (!inputPreview || inputPreview === label || isDomLikeSelectionLabel(inputPreview))
      ? getSelectionPreviewFromHtml(html)
      : "";
  const preview = htmlPreview || inputPreview || label;

  return {
    kind,
    key,
    selector,
    label,
    preview,
    ...(tagName ? { tagName } : {}),
    ...(text ? { text } : {}),
    ...(html ? { html } : {})
  };
}
