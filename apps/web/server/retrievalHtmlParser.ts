import { load } from "cheerio";
import { isLikelyRetrievalHtml } from "./retrievalHttpClient.js";
import {
  clip,
  imageFromSearchResult,
  normalizeWhitespace,
  parseAbsoluteUrl,
  uniqueByUrl
} from "./retrievalPrimitives.js";
import type {
  ParsedPageSource,
  RetrievedImage,
  RetrievedLink,
  RetrievalConfig,
  SearchResult
} from "./retrievalTypes.js";
import { isRetrievalDomainPermitted } from "./retrievalUrlPolicy.js";
import type { RetrievalPageFetchResult } from "./retrievalHttpClient.js";

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSrcset(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export function parseRetrievalHtmlSource(
  page: RetrievalPageFetchResult,
  config: RetrievalConfig,
  seed?: SearchResult
): ParsedPageSource {
  if (!page.html) {
    const seedImage = imageFromSearchResult(seed);
    return {
      id: 0,
      kind: "page",
      url: page.url,
      finalUrl: page.finalUrl,
      title: seed?.title,
      snippet: seed?.snippet,
      provider: seed?.provider,
      searchRank: seed?.rank,
      status: page.status,
      contentType: page.contentType,
      fetchedAt: page.fetchedAt,
      images: seedImage ? [seedImage] : [],
      links: []
    };
  }

  const $ = load(page.html);
  const scriptCount = $("script").length;
  $("script, style, noscript, template, svg, canvas").remove();

  const title =
    clip($("meta[property='og:title']").attr("content"), 220) ||
    clip($("title").first().text(), 220) ||
    seed?.title;
  const description =
    clip($("meta[name='description']").attr("content"), 420) ||
    clip($("meta[property='og:description']").attr("content"), 420) ||
    seed?.snippet;
  const siteName = clip($("meta[property='og:site_name']").attr("content"), 120);

  const textParts: string[] = [];
  const main = $("article, main, [role='main']").first();
  const root = main.length ? main : $("body");
  root.find("h1,h2,h3,h4,p,li,blockquote,figcaption,th,td").each((_, el) => {
    const text = clip($(el).text(), 900);
    if (text && !textParts.includes(text)) {
      textParts.push(text);
    }
  });

  let text = normalizeWhitespace(textParts.join("\n\n"));
  if (!text) {
    text = normalizeWhitespace($("body").text());
  }
  const bodyTextCharCount = text.length;

  const links: RetrievedLink[] = [];
  $("a[href]").each((_, el) => {
    const url = parseAbsoluteUrl($(el).attr("href") ?? "", page.finalUrl);
    if (!url || !isRetrievalDomainPermitted(url, config)) {
      return;
    }

    links.push({
      url,
      text: clip($(el).text(), 140)
    });
  });

  const images: RetrievedImage[] = [];
  const seedImage = imageFromSearchResult(seed);
  const pushImage = (rawUrl: string | undefined, alt?: string) => {
    if (!rawUrl) {
      return;
    }

    const url = parseAbsoluteUrl(rawUrl, page.finalUrl);
    if (!url || !isRetrievalDomainPermitted(url, config)) {
      return;
    }

    images.push({
      url,
      alt: clip(alt, 160)
    });
  };

  pushImage($("meta[property='og:image']").attr("content"), title);
  if (seedImage) {
    images.push(seedImage);
  }
  $("img[src], img[data-src]").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    const imageUrl = parseAbsoluteUrl(src ?? "", page.finalUrl);
    if (!imageUrl || !isRetrievalDomainPermitted(imageUrl, config)) {
      return;
    }

    images.push({
      url: imageUrl,
      alt: clip($(el).attr("alt"), 160),
      width: parseNumber($(el).attr("width")),
      height: parseNumber($(el).attr("height"))
    });
  });
  $("source[srcset], img[srcset]").each((_, el) => {
    for (const src of parseSrcset($(el).attr("srcset") ?? "")) {
      pushImage(src, $(el).attr("alt"));
    }
  });

  return {
    id: 0,
    kind: "page",
    url: page.url,
    finalUrl: page.finalUrl,
    title,
    snippet: description,
    text: clip(text, config.pageMaxChars),
    siteName,
    provider: seed?.provider,
    searchRank: seed?.rank,
    status: page.status,
    contentType: page.contentType,
    fetchedAt: page.fetchedAt,
    htmlCharCount: page.html.length,
    scriptCount,
    bodyTextCharCount,
    images: seedImage
      ? [seedImage]
      : uniqueByUrl(images).slice(0, config.maxImagesPerPage),
    links: uniqueByUrl(links).slice(0, config.maxLinksPerPage)
  };
}

export function shouldRenderSpaFallback(source: {
  status?: number;
  contentType?: string;
  text?: string;
  snippet?: string;
  images?: RetrievedImage[];
  links?: RetrievedLink[];
  htmlCharCount?: number;
  scriptCount?: number;
  bodyTextCharCount?: number;
}): boolean {
  const status = source.status ?? 200;
  const contentType = source.contentType ?? "";
  const textLength = normalizeWhitespace(source.text ?? "").length;
  const snippetLength = normalizeWhitespace(source.snippet ?? "").length;
  const visibleTextLength = Math.max(
    textLength,
    source.bodyTextCharCount ?? 0,
    snippetLength
  );
  const imageCount = source.images?.length ?? 0;
  const linkCount = source.links?.length ?? 0;
  const htmlCharCount = source.htmlCharCount ?? 0;
  const scriptCount = source.scriptCount ?? 0;

  return (
    status >= 200 &&
    status < 300 &&
    (!contentType || isLikelyRetrievalHtml(contentType)) &&
    htmlCharCount >= 800 &&
    scriptCount >= 1 &&
    visibleTextLength < 180 &&
    imageCount === 0 &&
    linkCount <= 2
  );
}
