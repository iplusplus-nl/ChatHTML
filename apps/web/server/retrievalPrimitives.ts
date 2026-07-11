import type {
  RetrievedImage,
  SearchResult
} from "./retrievalTypes.js";

export function clip(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseAbsoluteUrl(
  value: string,
  baseUrl?: string
): string | undefined {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

export function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = item.url.replace(/\/$/, "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

export function compactParts(
  values: Array<string | undefined>
): string | undefined {
  const parts = values
    .map((value) => clip(value, 220))
    .filter((value): value is string => Boolean(value));

  return parts.length ? parts.join(" · ") : undefined;
}

export function imageFromSearchResult(
  result: SearchResult | undefined
): RetrievedImage | undefined {
  if (!result?.imageUrl) {
    return undefined;
  }

  return {
    url: result.imageUrl,
    alt: result.imageAlt || result.title,
    width: result.imageWidth,
    height: result.imageHeight,
    creator: result.imageCreator,
    credit: result.imageCredit,
    license: result.imageLicense,
    licenseUrl: result.imageLicenseUrl
  };
}

export function sourceKey(url: string): string {
  return url.replace(/\/$/, "");
}

export function decodeSearchText(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export async function mapLimited<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker())
  );

  return results;
}
