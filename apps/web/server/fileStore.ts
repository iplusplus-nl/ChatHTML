import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_STORED_FILE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "../..");
const sessionsDir = path.resolve(
  process.env.STREAMUI_SESSION_DIR || path.join(workspaceRoot, "sessions")
);
const filesDir = path.resolve(
  process.env.STREAMUI_FILE_DIR || path.join(sessionsDir, "files")
);

export type StoredFileKind = "image" | "artifact" | "text";

export type StoredFileInput = {
  kind: StoredFileKind;
  sessionId: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  text?: string;
};

export type StoredFileRecord = {
  storageKey: string;
  contentHash: string;
  size: number;
  mimeType: string;
};

export type StoredFileContent = {
  buffer: Buffer;
  mimeType: string;
};

function safePathSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
  return normalized || "file";
}

function getExtension(name: string, mimeType: string): string {
  const extension = path.extname(name).slice(0, 12);
  if (extension) {
    return extension;
  }

  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }
  if (mimeType === "text/html") {
    return ".html";
  }
  return ".txt";
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Invalid data URL.");
  }

  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return { mimeType, buffer };
}

function assertSafeStorageKey(storageKey: string): string {
  if (!/^[a-zA-Z0-9._/-]+$/.test(storageKey) || storageKey.includes("..")) {
    throw new Error("Invalid file storage key.");
  }

  const resolved = path.resolve(filesDir, storageKey);
  if (!resolved.startsWith(`${filesDir}${path.sep}`)) {
    throw new Error("Invalid file storage path.");
  }

  return resolved;
}

function toContentBuffer(input: StoredFileInput): {
  buffer: Buffer;
  mimeType: string;
} {
  if (input.kind === "image") {
    if (!input.dataUrl) {
      throw new Error("Image uploads require dataUrl.");
    }
    const parsed = parseDataUrl(input.dataUrl);
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(parsed.mimeType)) {
      throw new Error(`${parsed.mimeType} is not a supported image type.`);
    }
    return parsed;
  }

  const text = input.text ?? "";
  if (!text.trim()) {
    throw new Error("Text file uploads require text content.");
  }

  return {
    buffer: Buffer.from(text, "utf8"),
    mimeType: input.mimeType || (input.kind === "artifact" ? "text/html" : "text/plain")
  };
}

export function createStoredFileId(kind: StoredFileKind): string {
  return `file-${kind}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export function createFileAccessToken(): string {
  return randomUUID().replace(/-/g, "");
}

export async function putStoredFile(
  fileId: string,
  input: StoredFileInput
): Promise<StoredFileRecord> {
  const { buffer, mimeType } = toContentBuffer(input);
  if (buffer.byteLength > MAX_STORED_FILE_BYTES) {
    throw new Error("File is too large.");
  }

  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const extension = getExtension(input.name, mimeType);
  const storageKey = [
    safePathSegment(input.sessionId),
    safePathSegment(fileId),
    `content-${contentHash.slice(0, 12)}${extension}`
  ].join("/");
  const storagePath = assertSafeStorageKey(storageKey);

  await mkdir(path.dirname(storagePath), { recursive: true, mode: 0o700 });
  await writeFile(storagePath, buffer, { mode: 0o600 });

  return {
    storageKey,
    contentHash,
    size: buffer.byteLength,
    mimeType
  };
}

export async function readStoredFile(
  storageKey: string,
  mimeType: string
): Promise<StoredFileContent> {
  const storagePath = assertSafeStorageKey(storageKey);
  const buffer = await readFile(storagePath);
  return { buffer, mimeType };
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  const storagePath = assertSafeStorageKey(storageKey);
  await rm(storagePath, { force: true });
}

export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
