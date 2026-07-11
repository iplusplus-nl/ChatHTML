import type { StoredFileKind } from "./fileStore.js";

const INLINE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export type SessionFileResponsePolicy = {
  contentType: string;
  crossOriginResourcePolicy: "cross-origin" | "same-origin";
  disposition: "attachment" | "inline";
  allowCrossOriginRead: boolean;
};

export function normalizeSessionFileResponseMimeType(value: unknown): string {
  const mimeType =
    typeof value === "string"
      ? value.split(";", 1)[0].trim().toLowerCase()
      : "";
  return MIME_TYPE_PATTERN.test(mimeType)
    ? mimeType
    : "application/octet-stream";
}

export function getSessionFileResponsePolicy(
  kind: StoredFileKind,
  value: unknown
): SessionFileResponsePolicy {
  const storedContentType = normalizeSessionFileResponseMimeType(value);
  const inline =
    kind === "image" && INLINE_IMAGE_MIME_TYPES.has(storedContentType);

  return {
    contentType: inline ? storedContentType : "application/octet-stream",
    disposition: inline ? "inline" : "attachment",
    allowCrossOriginRead: inline,
    crossOriginResourcePolicy: inline ? "cross-origin" : "same-origin"
  };
}
