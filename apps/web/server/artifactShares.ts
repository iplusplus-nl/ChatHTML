import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ArtifactShareThemeMode = "day" | "night";

export type ArtifactShareRecord = {
  id: string;
  title: string;
  createdAt: string;
  themeMode: ArtifactShareThemeMode;
  document: string;
  sourceMessageId?: string;
};

const ARTIFACT_SHARE_MAX_DOCUMENT_CHARS = 5_000_000;
const ARTIFACT_SHARE_ID_PATTERN = /^share-[a-z0-9-]{12,80}$/;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "../..");
const sessionsDir = path.resolve(
  process.env.STREAMUI_SESSION_DIR || path.join(workspaceRoot, "sessions")
);
const artifactSharesDir = path.resolve(
  process.env.STREAMUI_ARTIFACT_SHARE_DIR ||
    path.join(sessionsDir, "artifact-shares")
);

class ArtifactShareError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function getString(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function normalizeTitle(input: unknown): string {
  return getString(input).trim().replace(/\s+/g, " ").slice(0, 120) || "Artifact";
}

function normalizeThemeMode(input: unknown): ArtifactShareThemeMode {
  return input === "day" ? "day" : "night";
}

function normalizeSourceMessageId(input: unknown): string | undefined {
  const value = getString(input).trim().slice(0, 180);
  return value || undefined;
}

function createShareId(): string {
  return `share-${Date.now().toString(36)}-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 18)}`;
}

function getSharePath(id: string): string {
  if (!ARTIFACT_SHARE_ID_PATTERN.test(id)) {
    throw new ArtifactShareError(404, "Artifact share not found.");
  }

  return path.join(artifactSharesDir, `${id}.json`);
}

function getRequestOrigin(req: Request): string {
  const forwardedProto = getString(req.headers["x-forwarded-proto"])
    .split(",")[0]
    .trim();
  const forwardedHost = getString(req.headers["x-forwarded-host"])
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get("host") || "127.0.0.1:8787";
  return `${protocol}://${host}`;
}

function createRecord(input: unknown): ArtifactShareRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ArtifactShareError(400, "Artifact share payload is required.");
  }

  const body = input as {
    document?: unknown;
    sourceMessageId?: unknown;
    themeMode?: unknown;
    title?: unknown;
  };
  const document = getString(body.document);
  if (!document.trim()) {
    throw new ArtifactShareError(400, "Artifact document is required.");
  }
  if (document.length > ARTIFACT_SHARE_MAX_DOCUMENT_CHARS) {
    throw new ArtifactShareError(413, "Artifact document is too large.");
  }

  return {
    id: createShareId(),
    title: normalizeTitle(body.title),
    createdAt: new Date().toISOString(),
    themeMode: normalizeThemeMode(body.themeMode),
    document,
    sourceMessageId: normalizeSourceMessageId(body.sourceMessageId)
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createArtifactSharePageHtml(record: ArtifactShareRecord): string {
  const title = escapeHtml(record.title);
  const themeClass = record.themeMode === "day" ? "theme-day" : "theme-night";

  return `<!doctype html>
<html lang="en" class="${themeClass}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      --page-bg: #09090b;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --border: rgba(255, 255, 255, 0.12);
      --panel: rgba(24, 24, 27, 0.88);
    }
    .theme-day {
      color-scheme: light;
      --page-bg: #fafafa;
      --text: #18181b;
      --muted: #71717a;
      --border: #e4e4e7;
      --panel: rgba(255, 255, 255, 0.92);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--page-bg);
    }
    .share-shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .share-header {
      display: flex;
      min-height: 44px;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      backdrop-filter: blur(14px);
    }
    .share-title {
      min-width: 0;
      overflow: hidden;
      color: var(--text);
      font-size: 13px;
      font-weight: 620;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .share-badge {
      flex: 0 0 auto;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .share-main {
      width: min(960px, 100%);
      margin: 0 auto;
      padding: 18px 14px 28px;
    }
    iframe {
      display: block;
      width: 100%;
      min-height: 220px;
      border: 0;
      background: transparent;
    }
  </style>
</head>
<body>
  <main class="share-shell">
    <header class="share-header">
      <div class="share-title">${title}</div>
      <div class="share-badge">Experimental</div>
    </header>
    <section class="share-main">
      <iframe id="artifact-frame" title="${title}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" referrerpolicy="no-referrer"></iframe>
    </section>
  </main>
  <script id="artifact-document" type="application/json">${safeJsonScript(
    record.document
  )}</script>
  <script>
    const frame = document.getElementById("artifact-frame");
    const documentPayload = document.getElementById("artifact-document");
    const resizeFrame = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const body = doc.body;
      const root = doc.documentElement;
      const height = Math.ceil(Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        root ? root.scrollHeight : 0,
        root ? root.offsetHeight : 0,
        220
      ));
      frame.style.height = height + "px";
    };
    frame.addEventListener("load", () => {
      resizeFrame();
      const doc = frame.contentDocument;
      if (!doc || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(resizeFrame);
      observer.observe(doc.documentElement);
      if (doc.body) observer.observe(doc.body);
      window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
    });
    frame.srcdoc = JSON.parse(documentPayload.textContent || "\"\"");
  </script>
</body>
</html>
`;
}

async function writeShareRecord(record: ArtifactShareRecord): Promise<void> {
  await mkdir(artifactSharesDir, { recursive: true, mode: 0o700 });
  await writeFile(getSharePath(record.id), JSON.stringify(record), {
    encoding: "utf8",
    mode: 0o600
  });
}

async function readShareRecord(id: string): Promise<ArtifactShareRecord> {
  try {
    return JSON.parse(await readFile(getSharePath(id), "utf8")) as ArtifactShareRecord;
  } catch (error) {
    if (error instanceof ArtifactShareError) {
      throw error;
    }
    throw new ArtifactShareError(404, "Artifact share not found.");
  }
}

function getErrorStatus(error: unknown): number {
  return error instanceof ArtifactShareError ? error.status : 500;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Artifact share failed.";
}

export async function handleCreateArtifactShare(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const record = createRecord(req.body);
    await writeShareRecord(record);
    const path = `/experimental/artifacts/${encodeURIComponent(record.id)}`;
    res.status(201).json({
      experimental: true,
      id: record.id,
      path,
      url: `${getRequestOrigin(req)}${path}`
    });
  } catch (error) {
    res.status(getErrorStatus(error)).json({ error: getErrorMessage(error) });
  }
}

export async function handleGetArtifactSharePage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const record = await readShareRecord(req.params.shareId);
    res.status(200);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.send(createArtifactSharePageHtml(record));
  } catch (error) {
    res.status(getErrorStatus(error)).send(escapeHtml(getErrorMessage(error)));
  }
}
