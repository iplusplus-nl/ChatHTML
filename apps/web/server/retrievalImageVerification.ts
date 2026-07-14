import { validateRetrievalImageUrl } from "./retrievalHttpClient.js";
import {
  rethrowIfRetrievalAborted,
  throwIfRetrievalAborted
} from "./retrievalAbort.js";
import {
  decodeSearchText,
  mapLimited,
  uniqueStrings
} from "./retrievalPrimitives.js";
import type {
  RetrievedImage,
  RetrievalConfig,
  RetrievalSource,
  VerifiedImage
} from "./retrievalTypes.js";
import { matchesRetrievalDomain } from "./retrievalUrlPolicy.js";

const IMAGE_USER_AGENT =
  "Mozilla/5.0 (compatible; ChatHTML-Retrieval/0.1; +https://stream.aiz.ink)";

const IMAGE_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "gallery",
  "gallary",
  "galleries",
  "image",
  "images",
  "of",
  "photo",
  "photos",
  "pic",
  "pics",
  "picture",
  "pictures",
  "the",
  "wallpaper",
  "wallpapers"
]);

export type RetrievalImageCandidate = {
  image: RetrievedImage;
  source: RetrievalSource;
  order: number;
  score: number;
};

export type RetrievalImageValidator = (
  url: string,
  config: RetrievalConfig
) => Promise<{ url: string; contentType?: string } | null>;

export function retrievalImageQueryTerms(queries: string[]): string[] {
  const terms = new Set<string>();
  for (const query of queries) {
    for (const term of decodeSearchText(query).match(/[a-z0-9]+/g) ?? []) {
      if (term.length > 2 && !IMAGE_QUERY_STOP_WORDS.has(term)) {
        terms.add(term);
      }
    }
  }

  return [...terms];
}

export function isDecorativeRetrievalImage(image: RetrievedImage): boolean {
  const haystack = decodeSearchText(`${image.url} ${image.alt ?? ""}`);
  return (
    /\.(?:svg|ico)(?:[?#]|$)/i.test(image.url) ||
    /cdninstagram\.com\/v\/t\d+\.\d+-19\//i.test(image.url) ||
    /fbcdn\.net\/v\/t\d+\.\d+-1\//i.test(image.url) ||
    /\b(?:avatar|badge|blank|button|copyright|creative commons|favicon|icon|licen[cs]e|logo|placeholder|rights reserved|some rights reserved|sprite|wordmark)\b/i.test(
      haystack
    ) ||
    (typeof image.width === "number" &&
      typeof image.height === "number" &&
      image.width < 80 &&
      image.height < 80)
  );
}

export function retrievalImageDedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = decodeURIComponent(parsed.pathname);

    if (matchesRetrievalDomain(hostname, "upload.wikimedia.org")) {
      const basename = pathname
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/^\d+px-/i, "")
        .replace(/^\d+!/, "")
        .toLowerCase();

      if (basename) {
        return `${hostname}:${basename}`;
      }
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

function imageRelevanceScore(
  image: RetrievedImage,
  source: RetrievalSource,
  terms: string[]
): number {
  if (!terms.length) {
    return 0;
  }

  const imageHaystack = [image.url, image.alt].map(decodeSearchText).join(" ");
  const sourceHaystack = [source.title, source.snippet, source.siteName]
    .map(decodeSearchText)
    .join(" ");

  const imageMatches = terms.reduce(
    (score, term) => score + (imageHaystack.includes(term) ? 1 : 0),
    0
  );
  const sourceMatches = terms.reduce(
    (score, term) => score + (sourceHaystack.includes(term) ? 1 : 0),
    0
  );

  return imageMatches * 10 + sourceMatches;
}

export function collectRetrievalImageCandidates(
  sources: RetrievalSource[],
  queries: string[]
): RetrievalImageCandidate[] {
  const seen = new Set<string>();
  const terms = retrievalImageQueryTerms(queries);
  const candidates: RetrievalImageCandidate[] = [];

  for (const source of sources) {
    for (const image of source.images) {
      if (isDecorativeRetrievalImage(image)) {
        continue;
      }

      const imageUrl = image.url;
      const key = retrievalImageDedupeKey(imageUrl);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({
        image: {
          ...image,
          url: imageUrl
        },
        source,
        order: candidates.length,
        score: imageRelevanceScore(image, source, terms)
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  return candidates;
}

export function selectRetrievalImageCandidates(
  candidates: RetrievalImageCandidate[]
): RetrievalImageCandidate[] {
  const relevant = candidates.filter((candidate) => candidate.score > 0);
  return relevant.length >= 4 ? relevant : candidates;
}

export function formatVerifiedRetrievalImages(images: VerifiedImage[]): string[] {
  return images.slice(0, 24).map((image) => {
    const alt = image.alt ? ` (${image.alt})` : "";
    const sourceTitle = image.sourceTitle ? `, ${image.sourceTitle}` : "";
    const contentType = image.contentType ? `, ${image.contentType}` : "";
    const credit = image.credit ? `, ${image.credit}` : "";
    const license = image.license ? `, ${image.license}` : "";
    const licenseUrl = image.licenseUrl ? `, license: ${image.licenseUrl}` : "";
    return `  - ${image.url}${alt} [source ${image.sourceId}${sourceTitle}${contentType}${credit}${license}${licenseUrl}]`;
  });
}

const WIKIMEDIA_DISPLAY_IMAGE_WIDTH = 1280;

export function wikimediaOriginalImageUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (
      !matchesRetrievalDomain(
        parsed.hostname.toLowerCase(),
        "upload.wikimedia.org"
      ) ||
      !parsed.pathname.includes("/thumb/")
    ) {
      return undefined;
    }

    const withoutThumb = parsed.pathname.replace("/thumb/", "/");
    const lastSlash = withoutThumb.lastIndexOf("/");
    if (lastSlash <= 0) {
      return undefined;
    }

    parsed.pathname = withoutThumb.slice(0, lastSlash);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function wikimediaDisplayImageUrl(url: string): string | undefined {
  try {
    const originalUrl = wikimediaOriginalImageUrl(url) ?? url;
    const parsed = new URL(originalUrl);
    if (
      !matchesRetrievalDomain(
        parsed.hostname.toLowerCase(),
        "upload.wikimedia.org"
      )
    ) {
      return undefined;
    }

    const match = parsed.pathname.match(/^(\/wikipedia\/[^/]+\/)(.+)$/);
    const filename = parsed.pathname.split("/").filter(Boolean).pop();
    if (!match || !filename || /\.svg$/i.test(filename)) {
      return undefined;
    }

    parsed.pathname = `${match[1]}thumb/${match[2]}/${WIKIMEDIA_DISPLAY_IMAGE_WIDTH}px-${filename}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function retrievalImageUrlVariants(url: string): string[] {
  return uniqueStrings([wikimediaDisplayImageUrl(url) ?? "", url]);
}

export function uniqueVerifiedRetrievalImages(
  images: VerifiedImage[]
): VerifiedImage[] {
  const seen = new Set<string>();
  const unique: VerifiedImage[] = [];

  for (const image of images) {
    const key = retrievalImageDedupeKey(image.url);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(image);
  }

  return unique;
}

async function validateImageUrl(
  url: string,
  config: RetrievalConfig
): Promise<{ url: string; contentType?: string } | null> {
  return validateRetrievalImageUrl(url, config, IMAGE_USER_AGENT);
}

export async function verifyRetrievalImageCandidates(
  sources: RetrievalSource[],
  queries: string[],
  config: RetrievalConfig,
  notes: string[],
  onStatus?: (message: string) => void,
  validate: RetrievalImageValidator = validateImageUrl
): Promise<VerifiedImage[]> {
  throwIfRetrievalAborted(config.signal);
  const rankedCandidates = collectRetrievalImageCandidates(sources, queries);
  const candidates = selectRetrievalImageCandidates(rankedCandidates).slice(0, 56);
  if (!candidates.length) {
    return [];
  }

  if (candidates.length < rankedCandidates.length) {
    notes.push(
      `Image relevance removed ${rankedCandidates.length - candidates.length} off-topic candidates.`
    );
  }

  onStatus?.(`Retrieving: verifying ${candidates.length} image candidates...`);
  let rejected = 0;
  const verified = await mapLimited<
    RetrievalImageCandidate,
    VerifiedImage | null
  >(candidates, 4, async (candidate) => {
    throwIfRetrievalAborted(config.signal);
    for (const variant of retrievalImageUrlVariants(candidate.image.url)) {
      throwIfRetrievalAborted(config.signal);
      try {
        const result = await validate(variant, config);
        if (result) {
          return {
            ...candidate.image,
            url: result.url,
            sourceId: candidate.source.id,
            ...(candidate.source.title
              ? { sourceTitle: candidate.source.title }
              : {}),
            sourceUrl: candidate.source.finalUrl || candidate.source.url,
            ...(result.contentType ? { contentType: result.contentType } : {})
          };
        }
      } catch (error) {
        rethrowIfRetrievalAborted(error, config.signal);
        // Try the next variant, then count the candidate as rejected below.
      }
    }

    rejected += 1;
    return null;
  });

  if (rejected) {
    notes.push(`Image verification rejected ${rejected} non-loadable candidate URLs.`);
  }

  return uniqueVerifiedRetrievalImages(
    verified.filter((image): image is VerifiedImage => image !== null)
  ).slice(0, 18);
}

export function sourcesWithVerifiedRetrievalImages(
  sources: RetrievalSource[],
  verifiedImages: VerifiedImage[]
): RetrievalSource[] {
  const bySource = new Map<number, RetrievedImage[]>();
  for (const image of verifiedImages) {
    const images = bySource.get(image.sourceId) ?? [];
    images.push({
      url: image.url,
      alt: image.alt,
      width: image.width,
      height: image.height,
      creator: image.creator,
      credit: image.credit,
      license: image.license,
      licenseUrl: image.licenseUrl
    });
    bySource.set(image.sourceId, images);
  }

  return sources.map((source) => ({
    ...source,
    images: bySource.get(source.id) ?? []
  }));
}
