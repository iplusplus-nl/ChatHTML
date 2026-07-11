import type { BugReportDraft, BugReportImage } from "./sessionTypes";

export const MAX_BUG_REPORT_IMAGES = 8;
export const MAX_BUG_REPORT_TEXT_LENGTH = 12_000;

const MAX_BUG_REPORT_IMAGE_DATA_URL_CHARS = 20_000_000;
const BUG_REPORT_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

export function createEmptyBugReportDraft(now = Date.now()): BugReportDraft {
  return {
    text: "",
    images: [],
    updatedAt: now
  };
}

export function isBugReportDraftEmpty(
  draft: BugReportDraft | undefined | null
): boolean {
  return !draft || (!draft.text.trim() && draft.images.length === 0);
}

function normalizeBugReportImage(
  input: unknown,
  now = Date.now()
): BugReportImage | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const image = input as Partial<BugReportImage>;
  const id = typeof image.id === "string" ? image.id.trim() : "";
  const name = typeof image.name === "string" ? image.name.trim() : "";
  const mimeType =
    typeof image.mimeType === "string" ? image.mimeType.trim().toLowerCase() : "";
  const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl.trim() : "";

  if (
    !id ||
    !name ||
    !BUG_REPORT_IMAGE_MIME_TYPES.has(mimeType) ||
    !dataUrl.startsWith(`data:${mimeType};base64,`) ||
    dataUrl.length > MAX_BUG_REPORT_IMAGE_DATA_URL_CHARS
  ) {
    return null;
  }

  return {
    id: id.slice(0, 160),
    name: name.slice(0, 180),
    mimeType,
    size:
      typeof image.size === "number" && Number.isFinite(image.size)
        ? Math.max(0, Math.round(image.size))
        : 0,
    dataUrl,
    width:
      typeof image.width === "number" && Number.isFinite(image.width)
        ? Math.max(1, Math.round(image.width))
        : undefined,
    height:
      typeof image.height === "number" && Number.isFinite(image.height)
        ? Math.max(1, Math.round(image.height))
        : undefined,
    captured: image.captured ? true : undefined,
    createdAt:
      typeof image.createdAt === "number" && Number.isFinite(image.createdAt)
        ? image.createdAt
        : now
  };
}

export function normalizeBugReportDraft(
  input: unknown,
  now = Date.now()
): BugReportDraft | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const draft = input as Partial<BugReportDraft>;
  const seen = new Set<string>();
  const images: BugReportImage[] = [];
  if (Array.isArray(draft.images)) {
    for (const item of draft.images) {
      const image = normalizeBugReportImage(item, now);
      if (!image || seen.has(image.id)) {
        continue;
      }
      seen.add(image.id);
      images.push(image);
      if (images.length >= MAX_BUG_REPORT_IMAGES) {
        break;
      }
    }
  }

  const text =
    typeof draft.text === "string"
      ? draft.text.slice(0, MAX_BUG_REPORT_TEXT_LENGTH)
      : "";
  const updatedAt =
    typeof draft.updatedAt === "number" && Number.isFinite(draft.updatedAt)
      ? draft.updatedAt
      : now;
  const screenshotCapturedAt =
    typeof draft.screenshotCapturedAt === "number" &&
    Number.isFinite(draft.screenshotCapturedAt)
      ? draft.screenshotCapturedAt
      : undefined;

  if (!text.trim() && images.length === 0 && !screenshotCapturedAt) {
    return undefined;
  }

  return {
    text,
    images,
    updatedAt,
    screenshotCapturedAt
  };
}
