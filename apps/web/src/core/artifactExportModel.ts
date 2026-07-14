import { buildIframeDocument } from "../runtime/streamui/sandboxDocument";
import type { PageThemeMode, RenderSnapshot } from "../runtime/streamui/types";
import { htmlToTranscriptText } from "./artifactContext";

const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_PIXELS = 32_000_000;

export type ArtifactExtension = "png" | "svg" | "html" | "txt";

export type ArtifactExportDiagnosticsOptions = {
  exportWidth?: number;
  themeMode?: PageThemeMode;
};

export function getArtifactExportScale(width: number, height: number) {
  const deviceScale = Math.min(
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    2
  );
  const dimensionScale = Math.min(
    MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height
  );
  const pixelScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));

  return Math.max(0.1, Math.min(deviceScale, dimensionScale, pixelScale));
}

export function getSnapshotSourceCode(snapshot: RenderSnapshot): string {
  const source =
    snapshot.raw || snapshot.completedHtml || snapshot.iframeDocument || "";

  return source.endsWith("\n") ? source : `${source}\n`;
}

export function getSnapshotVisibleText(snapshot: RenderSnapshot): string {
  return htmlToTranscriptText(
    snapshot.completedHtml || snapshot.iframeDocument || snapshot.raw
  );
}

export function getSnapshotHtmlDocument(
  snapshot: RenderSnapshot,
  themeMode?: PageThemeMode
): string {
  const html = snapshot.completedHtml || snapshot.raw;
  const document = html
    ? buildIframeDocument(html, themeMode ?? "night")
    : snapshot.iframeDocument;

  return document.endsWith("\n") ? document : `${document}\n`;
}

export function createArtifactFilename(
  baseName: string,
  extension: ArtifactExtension
): string {
  const sanitized = baseName
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${sanitized || "chathtml-artifact"}.${extension}`;
}

export function normalizeSvgMarkup(markup: string): string {
  const trimmed = markup.trim();

  if (trimmed.startsWith("<?xml")) {
    return `${trimmed}\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${trimmed}\n`;
}

export function stripExecutableScriptsFromExportDocument(
  documentMarkup: string
): string {
  return documentMarkup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "");
}

export function getSnapshotDiagnostics(
  snapshot: RenderSnapshot,
  options: ArtifactExportDiagnosticsOptions = {}
): string {
  const visibleText = getSnapshotVisibleText(snapshot);
  const lines = [
    "ChatHTML Artifact Diagnostics",
    `Generated: ${new Date().toISOString()}`,
    `Status: ${snapshot.status}`,
    `Theme mode: ${options.themeMode ?? "unknown"}`,
    `Requested export width: ${options.exportWidth ?? "unknown"}`,
    "",
    "Source sizes:",
    `- Raw source chars: ${snapshot.raw.length}`,
    `- Completed HTML chars: ${snapshot.completedHtml.length}`,
    `- Iframe document chars: ${snapshot.iframeDocument.length}`,
    `- Visible text chars: ${visibleText.length}`,
    "",
    "Render errors:",
    snapshot.errors.length
      ? snapshot.errors
          .map((error, index) => {
            return `${index + 1}. ${error.kind}: ${error.message} (${new Date(
              error.timestamp
            ).toISOString()})`;
          })
          .join("\n")
      : "- none",
    "",
    "Visible text:",
    visibleText || "(none)",
    "",
    "Raw source:",
    getSnapshotSourceCode(snapshot),
    "",
    "Completed HTML:",
    snapshot.completedHtml || "(none)"
  ];

  return `${lines.join("\n")}\n`;
}
