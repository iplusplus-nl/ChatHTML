import type { Request, Response } from "express";

const EXPORT_RESOURCE_MAX_BYTES = 10 * 1024 * 1024;
const EXPORT_RESOURCE_TIMEOUT_MS = 10_000;
const EXPORT_RESOURCE_USER_AGENT =
  "ChatHTML-Export/0.1 (+https://localhost; local artifact export service)";

class ExportResourceError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type ExportResource = {
  body: Buffer;
  contentType: string;
  finalUrl: string;
};

function getSingleQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

export function normalizeExportResourceUrl(value: unknown): string | undefined {
  const raw = getSingleQueryValue(value)?.trim();
  if (!raw) {
    return undefined;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isExportableImageContentType(value: string | null): boolean {
  const contentType = value?.split(";")[0]?.trim().toLowerCase();
  return Boolean(contentType?.startsWith("image/"));
}

function getContentLength(response: globalThis.Response): number | undefined {
  const value = response.headers.get("content-length");
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readLimitedBody(response: globalThis.Response): Promise<Buffer> {
  const contentLength = getContentLength(response);
  if (contentLength && contentLength > EXPORT_RESOURCE_MAX_BYTES) {
    throw new ExportResourceError(413, "Export resource is too large.");
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > EXPORT_RESOURCE_MAX_BYTES) {
    throw new ExportResourceError(413, "Export resource is too large.");
  }

  return body;
}

async function fetchExportResource(url: string): Promise<ExportResource> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(EXPORT_RESOURCE_TIMEOUT_MS),
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.1",
      "User-Agent": EXPORT_RESOURCE_USER_AGENT
    }
  });
  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";

  if (!response.ok) {
    throw new ExportResourceError(
      502,
      `Export resource fetch failed with HTTP ${response.status}.`
    );
  }

  if (!isExportableImageContentType(contentType)) {
    throw new ExportResourceError(415, "Export resource is not an image.");
  }

  return {
    body: await readLimitedBody(response),
    contentType,
    finalUrl: response.url || url
  };
}

function getErrorStatus(error: unknown): number {
  if (error instanceof ExportResourceError) {
    return error.status;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return 504;
  }
  return 502;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Could not fetch export resource.";
}

export async function handleExportResourceRequest(
  req: Request,
  res: Response
): Promise<void> {
  const url = normalizeExportResourceUrl(req.query.url);
  if (!url) {
    res.status(400).json({ error: "A valid http or https URL is required." });
    return;
  }

  try {
    const resource = await fetchExportResource(url);
    res.status(200);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Content-Type", resource.contentType);
    res.setHeader("Content-Length", String(resource.body.byteLength));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Export-Resource-Url", resource.finalUrl);
    res.send(resource.body);
  } catch (error) {
    res.status(getErrorStatus(error)).json({ error: getErrorMessage(error) });
  }
}
