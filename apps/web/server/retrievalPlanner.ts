import {
  clip,
  decodeSearchText,
  parseAbsoluteUrl,
  uniqueStrings
} from "./retrievalPrimitives.js";
import type {
  RetrievalMessage,
  RetrievalOptions,
  SearchResult
} from "./retrievalTypes.js";
import {
  getRetrievalHostname,
  matchesRetrievalDomain
} from "./retrievalUrlPolicy.js";

export function extractRetrievalUrls(text: string): string[] {
  const urls = new Set<string>();
  const explicitUrlPattern =
    /\bhttps?:\/\/[^\s<>"'`)\]}]+|\bwww\.[^\s<>"'`)\]}]+/gi;

  for (const match of text.matchAll(explicitUrlPattern)) {
    const raw = match[0].replace(/[.,;:!?]+$/, "");
    const normalized = parseAbsoluteUrl(
      raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw
    );
    if (normalized) {
      urls.add(normalized);
    }
  }

  return [...urls];
}

export function removeRetrievalUrls(text: string): string {
  return text.replace(
    /\bhttps?:\/\/[^\s<>"'`)\]}]+|\bwww\.[^\s<>"'`)\]}]+/gi,
    " "
  );
}

export function asksForVisualResources(text: string): boolean {
  return /\b(gallery|galleries|gallary|image|images|photo|photos|picture|pictures|pic|pics|screenshot|screenshots|wallpaper|wallpapers|visual reference|visual references|media assets?)\b|图片|照片|图集|图库|相册|壁纸|素材|视觉参考/i.test(
    text
  );
}

export function shouldSearchRetrieval(
  text: string,
  options: Pick<RetrievalOptions, "forceSearch">,
  hasDirectUrls: boolean
): boolean {
  if (options.forceSearch) {
    return true;
  }

  if (hasDirectUrls) {
    const textWithoutUrls = removeRetrievalUrls(text);
    const urlCompanionCues =
      /\b(search|web|online|current|recent|latest|today|news|find related|related sources|more sources|other sources|references|images|photos|screenshots|assets|examples|alternatives|compare|official)\b|搜索|查一下|查询|最新|今天|现在|新闻|相关|更多来源|其他来源|参考|资料|图片|素材|例子|示例|对比|官网/i;

    return urlCompanionCues.test(textWithoutUrls);
  }

  const cues =
    /\b(current|recent|latest|today|tonight|tomorrow|yesterday|news|search|web|online|source|sources|reference|references|link|links|page|url|site|website|browse|fetch|read|lookup|look up|find|research|official|image|images|photo|photos|picture|pictures|pic|pics|gallery|galleries|gallary|screenshot|screenshots|wallpaper|wallpapers|media assets?|map|maps|weather|price|prices|schedule|release|version)\b|最新|今天|现在|新闻|搜索|查一下|查询|网页|网站|链接|来源|资料|参考|官网|浏览|读取|找|图片|照片|图集|图库|相册|壁纸|素材|地图|价格|日程|版本|发布|当前/i;

  return cues.test(text);
}

export function buildRetrievalSearchQuery(text: string): string {
  const original = clip(removeRetrievalUrls(text), 260) || clip(text, 260) || "";
  if (!original) {
    return "";
  }

  if (!asksForVisualResources(text)) {
    return original;
  }

  const cleaned = original
    .replace(
      /^\s*(?:please\s+)?(?:generate|create|make|build|design|write|show(?:\s+me)?)\s+(?:an?\s+|the\s+)?/i,
      ""
    )
    .replace(
      /^\s*(?:gallery|galleries|gallary|photo\s+gallery|image\s+gallery|picture\s+gallery)\s+(?:of|for)?\s*/i,
      ""
    )
    .replace(/^\s*(?:of|for)\s+/i, "")
    .trim();
  const query = cleaned || original;

  if (
    /\b(image|images|photo|photos|picture|pictures|gallery|galleries|wallpaper|wallpapers)\b/i.test(
      query
    )
  ) {
    return clip(query, 260) || query;
  }

  return clip(`${query} photos images`, 260) || query;
}

export function buildRetrievalSearchQueries(text: string): string[] {
  const query = buildRetrievalSearchQuery(text);
  if (!query) {
    return [];
  }

  if (!asksForVisualResources(text)) {
    return [query];
  }

  return uniqueStrings([
    query,
    `${query} Wikimedia Commons`,
    `${query} site:commons.wikimedia.org`
  ]).slice(0, 3);
}

export function latestRetrievalUserText(
  messages: RetrievalMessage[]
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }

  return "";
}

export function visualRetrievalResultScore(result: SearchResult): number {
  const hostname = getRetrievalHostname(result.url) ?? "";
  const haystack = decodeSearchText(
    `${result.url} ${result.title ?? ""} ${result.snippet ?? ""} ${result.provider}`
  );
  let score = 0;

  if (
    [
      "openverse",
      "pexels",
      "unsplash",
      "nasa",
      "loc",
      "met",
      "artic",
      "rijksmuseum"
    ].includes(result.provider)
  ) {
    score += 90;
  } else if (matchesRetrievalDomain(hostname, "commons.wikimedia.org")) {
    score += 80;
  } else if (matchesRetrievalDomain(hostname, "wikimedia.org")) {
    score += 60;
  } else if (matchesRetrievalDomain(hostname, "wikipedia.org")) {
    score += 35;
  } else if (
    matchesRetrievalDomain(hostname, "openverse.org") ||
    matchesRetrievalDomain(hostname, "pexels.com") ||
    matchesRetrievalDomain(hostname, "unsplash.com") ||
    matchesRetrievalDomain(hostname, "nasa.gov") ||
    matchesRetrievalDomain(hostname, "loc.gov") ||
    matchesRetrievalDomain(hostname, "metmuseum.org") ||
    matchesRetrievalDomain(hostname, "artic.edu") ||
    matchesRetrievalDomain(hostname, "rijksmuseum.nl")
  ) {
    score += 70;
  } else if (matchesRetrievalDomain(hostname, "flickr.com")) {
    score += 20;
  }

  if (result.imageUrl) {
    score += 10;
  }

  if (/\b(?:photo|photos|image|images|gallery|commons|media|wallpaper)\b/i.test(haystack)) {
    score += 6;
  }

  if (/\b(?:getty|shutterstock|alamy|istock|adobe stock|stock photos?)\b/i.test(haystack)) {
    score -= 30;
  }

  return score;
}

export function prioritizeRetrievalSearchResults(
  results: SearchResult[],
  text: string
): SearchResult[] {
  if (!asksForVisualResources(text)) {
    return results;
  }

  return [...results].sort(
    (a, b) =>
      visualRetrievalResultScore(b) - visualRetrievalResultScore(a) ||
      a.rank - b.rank
  );
}
