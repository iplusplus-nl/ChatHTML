import type { Request, Response } from "express";
import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_RETRIEVAL_ENABLED = true;
const DEFAULT_SEARCH_PROVIDER = "auto";
const DEFAULT_SEARCH_MAX_RESULTS = 5;
const DEFAULT_FETCH_MAX_PAGES = 4;
const DEFAULT_PAGE_MAX_CHARS = 10_000;
const DEFAULT_CONTEXT_MAX_CHARS = 32_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_BROWSER_ENGINE = "fetch";
const DEFAULT_ALLOW_DUCKDUCKGO_FALLBACK = true;
const DEFAULT_ALLOW_PRIVATE_URLS = false;
const DEFAULT_MAX_LINKS_PER_PAGE = 24;
const DEFAULT_MAX_IMAGES_PER_PAGE = 18;
const USER_AGENT =
  "StreamUI-Retrieval/0.1 (+https://localhost; local development retrieval service)";

type SearchProvider = "auto" | "brave" | "tavily" | "serper" | "duckduckgo" | "none";
type BrowserEngine = "fetch" | "playwright";

export type RetrievalMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type RetrievedImage = {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type RetrievedLink = {
  url: string;
  text?: string;
};

export type RetrievalSource = {
  id: number;
  kind: "search-result" | "page";
  url: string;
  finalUrl?: string;
  title?: string;
  snippet?: string;
  text?: string;
  siteName?: string;
  provider?: string;
  searchRank?: number;
  status?: number;
  contentType?: string;
  fetchedAt?: string;
  images: RetrievedImage[];
  links: RetrievedLink[];
  error?: string;
};

export type RetrievalContext = {
  enabled: boolean;
  used: boolean;
  reason: string;
  nowIso: string;
  searchProvider?: string;
  queries: string[];
  urls: string[];
  sources: RetrievalSource[];
  notes: string[];
};

type SearchResult = {
  url: string;
  title?: string;
  snippet?: string;
  imageUrl?: string;
  provider: string;
  rank: number;
};

type RetrievalConfig = {
  enabled: boolean;
  searchProvider: SearchProvider;
  searchMaxResults: number;
  fetchMaxPages: number;
  pageMaxChars: number;
  contextMaxChars: number;
  timeoutMs: number;
  browserEngine: BrowserEngine;
  allowDuckDuckGoFallback: boolean;
  allowPrivateUrls: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  maxLinksPerPage: number;
  maxImagesPerPage: number;
};

type RetrievalOptions = {
  forceSearch?: boolean;
  forceFetch?: boolean;
  onStatus?: (message: string) => void;
};

type PageFetchResult = {
  url: string;
  finalUrl: string;
  status?: number;
  contentType?: string;
  html?: string;
  fetchedAt: string;
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.round(Math.min(max, Math.max(min, parsed)));
}

function normalizeChoice<T extends string>(
  value: unknown,
  fallback: T,
  allowed: readonly T[]
): T {
  if (typeof value === "string" && allowed.includes(value.trim() as T)) {
    return value.trim() as T;
  }

  return fallback;
}

function normalizeDomainList(value: unknown): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const domains = value
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return domains.length ? domains : undefined;
}

function getRetrievalConfig(): RetrievalConfig {
  return {
    enabled: normalizeBoolean(
      process.env.STREAMUI_RETRIEVAL,
      DEFAULT_RETRIEVAL_ENABLED
    ),
    searchProvider: normalizeChoice(
      process.env.STREAMUI_SEARCH_PROVIDER,
      DEFAULT_SEARCH_PROVIDER,
      ["auto", "brave", "tavily", "serper", "duckduckgo", "none"] as const
    ),
    searchMaxResults: clampInteger(
      process.env.STREAMUI_SEARCH_MAX_RESULTS,
      DEFAULT_SEARCH_MAX_RESULTS,
      1,
      10
    ),
    fetchMaxPages: clampInteger(
      process.env.STREAMUI_RETRIEVAL_MAX_PAGES,
      DEFAULT_FETCH_MAX_PAGES,
      0,
      10
    ),
    pageMaxChars: clampInteger(
      process.env.STREAMUI_PAGE_MAX_CHARS,
      DEFAULT_PAGE_MAX_CHARS,
      1_000,
      60_000
    ),
    contextMaxChars: clampInteger(
      process.env.STREAMUI_RETRIEVAL_CONTEXT_MAX_CHARS,
      DEFAULT_CONTEXT_MAX_CHARS,
      4_000,
      100_000
    ),
    timeoutMs: clampInteger(
      process.env.STREAMUI_RETRIEVAL_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      2_000,
      45_000
    ),
    browserEngine: normalizeChoice(
      process.env.STREAMUI_BROWSER_ENGINE,
      DEFAULT_BROWSER_ENGINE,
      ["fetch", "playwright"] as const
    ),
    allowDuckDuckGoFallback: normalizeBoolean(
      process.env.STREAMUI_SEARCH_ALLOW_DUCKDUCKGO,
      DEFAULT_ALLOW_DUCKDUCKGO_FALLBACK
    ),
    allowPrivateUrls: normalizeBoolean(
      process.env.STREAMUI_RETRIEVAL_ALLOW_PRIVATE_URLS,
      DEFAULT_ALLOW_PRIVATE_URLS
    ),
    allowedDomains: normalizeDomainList(
      process.env.STREAMUI_RETRIEVAL_ALLOWED_DOMAINS
    ),
    blockedDomains: normalizeDomainList(
      process.env.STREAMUI_RETRIEVAL_BLOCKED_DOMAINS
    ),
    maxLinksPerPage: DEFAULT_MAX_LINKS_PER_PAGE,
    maxImagesPerPage: DEFAULT_MAX_IMAGES_PER_PAGE
  };
}

function clip(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseAbsoluteUrl(value: string, baseUrl?: string): string | undefined {
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

function getHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isDomainPermitted(url: string, config: RetrievalConfig): boolean {
  const hostname = getHostname(url);
  if (!hostname) {
    return false;
  }

  if (
    config.blockedDomains?.some((domain) => matchesDomain(hostname, domain))
  ) {
    return false;
  }

  if (
    config.allowedDomains &&
    !config.allowedDomains.some((domain) => matchesDomain(hostname, domain))
  ) {
    return false;
  }

  return true;
}

function extractUrls(text: string): string[] {
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

function removeUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s<>"'`)\]}]+|\bwww\.[^\s<>"'`)\]}]+/gi, " ");
}

function shouldSearch(
  text: string,
  options: RetrievalOptions,
  hasDirectUrls: boolean
): boolean {
  if (options.forceSearch) {
    return true;
  }

  if (hasDirectUrls) {
    const textWithoutUrls = removeUrls(text);
    const urlCompanionCues =
      /\b(search|web|online|current|recent|latest|today|news|find related|related sources|more sources|other sources|references|images|photos|screenshots|assets|examples|alternatives|compare|official)\b|搜索|查一下|查询|最新|今天|现在|新闻|相关|更多来源|其他来源|参考|资料|图片|素材|例子|示例|对比|官网/i;

    return urlCompanionCues.test(textWithoutUrls);
  }

  const cues =
    /\b(current|recent|latest|today|tonight|tomorrow|yesterday|news|search|web|online|source|sources|reference|references|link|links|page|url|site|website|browse|fetch|read|lookup|look up|find|research|official|image|images|photo|photos|screenshot|map|maps|weather|price|prices|schedule|release|version)\b|最新|今天|现在|新闻|搜索|查一下|查询|网页|网站|链接|来源|资料|参考|官网|浏览|读取|找|图片|地图|价格|日程|版本|发布|当前/i;

  return cues.test(text);
}

function buildSearchQuery(text: string): string {
  return clip(removeUrls(text), 260) || clip(text, 260) || "";
}

function privateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function privateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function privateIpAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return privateIpv4(ip);
  }
  if (version === 6) {
    return privateIpv6(ip);
  }
  return true;
}

async function assertPublicUrl(
  url: string,
  config: RetrievalConfig
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be retrieved.");
  }

  if (!isDomainPermitted(url, config)) {
    throw new Error("URL is blocked by retrieval domain controls.");
  }

  if (config.allowPrivateUrls) {
    return;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Private and local URLs are disabled for retrieval.");
  }

  if (isIP(hostname)) {
    if (privateIpAddress(hostname)) {
      throw new Error("Private and local URLs are disabled for retrieval.");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.some((address) => privateIpAddress(address.address))) {
    throw new Error("Private and local URLs are disabled for retrieval.");
  }
}

function isLikelyHtml(contentType: string | undefined): boolean {
  if (!contentType) {
    return true;
  }

  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml") ||
    contentType.includes("text/plain")
  );
}

async function readResponseBody(response: globalThis.Response, maxBytes: number) {
  const body = response.body;
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode();
      break;
    }

    const remaining = maxBytes - received;
    const chunk =
      value.byteLength > remaining ? value.slice(0, remaining) : value;
    received += chunk.byteLength;
    text += decoder.decode(chunk, { stream: received < maxBytes });

    if (value.byteLength > remaining) {
      await reader.cancel();
      text += decoder.decode();
      break;
    }
  }

  return text;
}

async function fetchWithNodeFetch(
  url: string,
  config: RetrievalConfig
): Promise<PageFetchResult> {
  await assertPublicUrl(url, config);

  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
      "User-Agent": USER_AGENT
    }
  });
  const contentType = response.headers.get("content-type") ?? undefined;
  const finalUrl = response.url || url;

  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}.`);
  }

  if (!isLikelyHtml(contentType)) {
    return {
      url,
      finalUrl,
      status: response.status,
      contentType,
      fetchedAt: new Date().toISOString()
    };
  }

  return {
    url,
    finalUrl,
    status: response.status,
    contentType,
    html: await readResponseBody(response, config.pageMaxChars * 8),
    fetchedAt: new Date().toISOString()
  };
}

async function fetchWithPlaywright(
  url: string,
  config: RetrievalConfig
): Promise<PageFetchResult> {
  await assertPublicUrl(url, config);

  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<any>;
  const playwright = await dynamicImport("playwright");
  const browser = await playwright.chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 900 }
    });
    page.setDefaultNavigationTimeout(config.timeoutMs);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(3_000, config.timeoutMs)
      })
      .catch(() => undefined);

    const html = await page.content();
    const headers = response?.headers() ?? {};

    return {
      url,
      finalUrl: page.url() || url,
      status: response?.status(),
      contentType: headers["content-type"],
      html: html.slice(0, config.pageMaxChars * 8),
      fetchedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

async function fetchPage(
  url: string,
  config: RetrievalConfig
): Promise<PageFetchResult> {
  if (config.browserEngine === "playwright") {
    return fetchWithPlaywright(url, config);
  }

  return fetchWithNodeFetch(url, config);
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
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

function parseSrcset(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function parseHtmlSource(
  page: PageFetchResult,
  config: RetrievalConfig,
  seed?: SearchResult
): RetrievalSource {
  if (!page.html) {
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
      images: seed?.imageUrl ? [{ url: seed.imageUrl }] : [],
      links: []
    };
  }

  const $ = load(page.html);
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

  const links: RetrievedLink[] = [];
  $("a[href]").each((_, el) => {
    const url = parseAbsoluteUrl($(el).attr("href") ?? "", page.finalUrl);
    if (!url || !isDomainPermitted(url, config)) {
      return;
    }

    links.push({
      url,
      text: clip($(el).text(), 140)
    });
  });

  const images: RetrievedImage[] = [];
  const pushImage = (rawUrl: string | undefined, alt?: string) => {
    if (!rawUrl) {
      return;
    }

    const url = parseAbsoluteUrl(rawUrl, page.finalUrl);
    if (!url || !isDomainPermitted(url, config)) {
      return;
    }

    images.push({
      url,
      alt: clip(alt, 160)
    });
  };

  pushImage($("meta[property='og:image']").attr("content"), title);
  pushImage(seed?.imageUrl, seed?.title);
  $("img[src], img[data-src]").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    const imageUrl = parseAbsoluteUrl(src ?? "", page.finalUrl);
    if (!imageUrl || !isDomainPermitted(imageUrl, config)) {
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
    images: uniqueByUrl(images).slice(0, config.maxImagesPerPage),
    links: uniqueByUrl(links).slice(0, config.maxLinksPerPage)
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Search API returned HTTP ${response.status}.`);
  }

  return response.json();
}

async function searchBrave(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_SEARCH_API_KEY is not set.");
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(config.searchMaxResults));
  url.searchParams.set("text_decorations", "false");

  const data = (await fetchJson(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
        "User-Agent": USER_AGENT
      }
    },
    config.timeoutMs
  )) as {
    web?: {
      results?: Array<{
        url?: string;
        title?: string;
        description?: string;
        thumbnail?: { src?: string };
      }>;
    };
  };

  return (data.web?.results ?? [])
    .map((result, index) => ({
      url: parseAbsoluteUrl(result.url ?? "") ?? "",
      title: clip(result.title, 220),
      snippet: clip(result.description, 420),
      imageUrl: parseAbsoluteUrl(result.thumbnail?.src ?? ""),
      provider: "brave",
      rank: index + 1
    }))
    .filter((result) => result.url);
}

async function searchTavily(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set.");
  }

  const data = (await fetchJson(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: config.searchMaxResults,
        include_answer: false,
        include_raw_content: false
      })
    },
    config.timeoutMs
  )) as {
    results?: Array<{
      url?: string;
      title?: string;
      content?: string;
    }>;
  };

  return (data.results ?? [])
    .map((result, index) => ({
      url: parseAbsoluteUrl(result.url ?? "") ?? "",
      title: clip(result.title, 220),
      snippet: clip(result.content, 420),
      provider: "tavily",
      rank: index + 1
    }))
    .filter((result) => result.url);
}

async function searchSerper(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY is not set.");
  }

  const data = (await fetchJson(
    "https://google.serper.dev/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({
        q: query,
        num: config.searchMaxResults
      })
    },
    config.timeoutMs
  )) as {
    organic?: Array<{
      link?: string;
      title?: string;
      snippet?: string;
      imageUrl?: string;
    }>;
  };

  return (data.organic ?? [])
    .map((result, index) => ({
      url: parseAbsoluteUrl(result.link ?? "") ?? "",
      title: clip(result.title, 220),
      snippet: clip(result.snippet, 420),
      imageUrl: parseAbsoluteUrl(result.imageUrl ?? ""),
      provider: "serper",
      rank: index + 1
    }))
    .filter((result) => result.url);
}

function parseDuckDuckGoRedirect(value: string): string | undefined {
  const absolute = parseAbsoluteUrl(value, "https://duckduckgo.com");
  if (!absolute) {
    return undefined;
  }

  const parsed = new URL(absolute);
  const redirected = parsed.searchParams.get("uddg");
  return parseAbsoluteUrl(redirected || absolute);
}

async function searchDuckDuckGo(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const url = new URL("https://duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}.`);
  }

  const html = await readResponseBody(response, 700_000);
  const $ = load(html);
  const results: SearchResult[] = [];

  $(".result, .web-result").each((_, el) => {
    if (results.length >= config.searchMaxResults) {
      return;
    }

    const link = $(el).find(".result__a, a.result__url, a").first();
    const url = parseDuckDuckGoRedirect(link.attr("href") ?? "");
    if (!url) {
      return;
    }

    results.push({
      url,
      title: clip(link.text(), 220),
      snippet: clip($(el).find(".result__snippet").text(), 420),
      provider: "duckduckgo",
      rank: results.length + 1
    });
  });

  return results;
}

async function searchWeb(
  query: string,
  config: RetrievalConfig,
  notes: string[]
): Promise<SearchResult[]> {
  if (!query || config.searchProvider === "none") {
    return [];
  }

  const providers: SearchProvider[] =
    config.searchProvider === "auto"
      ? [
          process.env.BRAVE_SEARCH_API_KEY ? "brave" : undefined,
          process.env.TAVILY_API_KEY ? "tavily" : undefined,
          process.env.SERPER_API_KEY ? "serper" : undefined,
          config.allowDuckDuckGoFallback ? "duckduckgo" : undefined
        ].filter((provider): provider is SearchProvider => Boolean(provider))
      : [config.searchProvider];

  for (const provider of providers) {
    try {
      const results =
        provider === "brave"
          ? await searchBrave(query, config)
          : provider === "tavily"
            ? await searchTavily(query, config)
            : provider === "serper"
              ? await searchSerper(query, config)
              : provider === "duckduckgo"
                ? await searchDuckDuckGo(query, config)
                : [];

      const permitted = results.filter((result) =>
        isDomainPermitted(result.url, config)
      );
      if (permitted.length) {
        return permitted.slice(0, config.searchMaxResults);
      }

      notes.push(`${provider} returned no permitted search results.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`${provider} search failed: ${message}`);
    }
  }

  return [];
}

function toSearchSource(result: SearchResult): RetrievalSource {
  return {
    id: 0,
    kind: "search-result",
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    provider: result.provider,
    searchRank: result.rank,
    images: result.imageUrl ? [{ url: result.imageUrl }] : [],
    links: []
  };
}

function latestUserText(messages: RetrievalMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }

  return "";
}

function assignSourceIds(sources: RetrievalSource[]): RetrievalSource[] {
  return sources.map((source, index) => ({
    ...source,
    id: index + 1
  }));
}

function sourceKey(url: string): string {
  return url.replace(/\/$/, "");
}

async function fetchSources(
  urls: string[],
  searchResults: SearchResult[],
  config: RetrievalConfig,
  onStatus?: (message: string) => void
): Promise<RetrievalSource[]> {
  const seeds = new Map(searchResults.map((result) => [sourceKey(result.url), result]));
  const targets = uniqueByUrl(
    urls
      .map((url) => ({ url }))
      .filter((target) => isDomainPermitted(target.url, config))
  ).slice(0, config.fetchMaxPages);

  const fetched = await Promise.all(
    targets.map(async ({ url }) => {
      const hostname = getHostname(url) ?? url;
      onStatus?.(`Fetching ${hostname}...`);

      try {
        const page = await fetchPage(url, config);
        return parseHtmlSource(page, config, seeds.get(sourceKey(url)));
      } catch (error) {
        return {
          id: 0,
          kind: "page" as const,
          url,
          title: seeds.get(sourceKey(url))?.title,
          snippet: seeds.get(sourceKey(url))?.snippet,
          provider: seeds.get(sourceKey(url))?.provider,
          searchRank: seeds.get(sourceKey(url))?.rank,
          images: seeds.get(sourceKey(url))?.imageUrl
            ? [{ url: seeds.get(sourceKey(url))?.imageUrl ?? "" }]
            : [],
          links: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  return fetched;
}

export async function collectRetrievalContext(
  messages: RetrievalMessage[],
  options: RetrievalOptions = {}
): Promise<RetrievalContext> {
  const config = getRetrievalConfig();
  const nowIso = new Date().toISOString();
  const text = latestUserText(messages);
  const directUrls = extractUrls(text).filter((url) =>
    isDomainPermitted(url, config)
  );
  const query = buildSearchQuery(text);
  const searchNeeded = shouldSearch(text, options, directUrls.length > 0);
  const fetchNeeded = options.forceFetch || directUrls.length > 0;
  const notes: string[] = [];

  const base: RetrievalContext = {
    enabled: config.enabled,
    used: false,
    reason: "No external retrieval was needed for this request.",
    nowIso,
    queries: [],
    urls: directUrls,
    sources: [],
    notes
  };

  if (!config.enabled) {
    return {
      ...base,
      reason: "STREAMUI_RETRIEVAL is disabled."
    };
  }

  if (!text) {
    return {
      ...base,
      reason: "No user text was available for retrieval planning."
    };
  }

  if (!searchNeeded && !fetchNeeded) {
    return base;
  }

  const queries: string[] = [];
  let searchResults: SearchResult[] = [];

  if (searchNeeded && query) {
    queries.push(query);
    options.onStatus?.(`Searching the web for "${query}"...`);
    searchResults = await searchWeb(query, config, notes);
  }

  const searchUrls = searchResults.map((result) => result.url);
  const urlsToFetch = uniqueByUrl(
    [...directUrls, ...searchUrls].map((url) => ({ url }))
  ).map((target) => target.url);
  const pageSources =
    config.fetchMaxPages > 0
      ? await fetchSources(urlsToFetch, searchResults, config, options.onStatus)
      : [];
  const fetchedKeys = new Set(pageSources.map((source) => sourceKey(source.url)));
  const searchOnlySources = searchResults
    .filter((result) => !fetchedKeys.has(sourceKey(result.url)))
    .map(toSearchSource);
  const sources = assignSourceIds([...pageSources, ...searchOnlySources]);

  return {
    enabled: true,
    used: sources.length > 0 || notes.length > 0,
    reason:
      sources.length > 0
        ? "Independent StreamUI retrieval collected external context."
        : "Retrieval ran but did not return usable sources.",
    nowIso,
    searchProvider: searchResults[0]?.provider,
    queries,
    urls: urlsToFetch,
    sources,
    notes
  };
}

function formatImages(images: RetrievedImage[]): string[] {
  return images.slice(0, 6).map((image) => {
    const alt = image.alt ? ` (${image.alt})` : "";
    return `  - ${image.url}${alt}`;
  });
}

function formatLinks(links: RetrievedLink[]): string[] {
  return links.slice(0, 8).map((link) => {
    const text = link.text ? ` (${link.text})` : "";
    return `  - ${link.url}${text}`;
  });
}

export function buildRetrievalContextPrompt(context: RetrievalContext): string {
  const maxChars = getRetrievalConfig().contextMaxChars;
  const lines: string[] = [
    "Current runtime context:",
    `- Server timestamp: ${context.nowIso}`,
    "- Use this timestamp for current date/time grounding unless the user gives a different date.",
    "",
    "Independent StreamUI retrieval:",
    `- Status: ${context.used ? "ran" : "not run"}`,
    `- Reason: ${context.reason}`
  ];

  if (!context.used) {
    lines.push(
      "- No external web/page context was injected. Do not imply that you browsed the web."
    );
    return lines.join("\n");
  }

  if (context.queries.length) {
    lines.push(`- Search queries: ${context.queries.join(" | ")}`);
  }

  if (context.notes.length) {
    lines.push("- Retrieval notes:");
    for (const note of context.notes.slice(0, 6)) {
      lines.push(`  - ${note}`);
    }
  }

  lines.push(
    "",
    "Use the following sources only when relevant. When web context influences the answer, include concise source links in the HTML artifact."
  );

  for (const source of context.sources) {
    lines.push("");
    lines.push(`[${source.id}] ${source.title || source.url}`);
    lines.push(`URL: ${source.finalUrl || source.url}`);
    if (source.siteName) {
      lines.push(`Site: ${source.siteName}`);
    }
    if (source.provider || source.searchRank) {
      lines.push(
        `Search: ${source.provider || "unknown"}${
          source.searchRank ? ` rank ${source.searchRank}` : ""
        }`
      );
    }
    if (source.status) {
      lines.push(`HTTP status: ${source.status}`);
    }
    if (source.error) {
      lines.push(`Fetch error: ${source.error}`);
    }
    if (source.snippet) {
      lines.push(`Snippet: ${source.snippet}`);
    }
    if (source.text) {
      lines.push(`Extracted text: ${source.text}`);
    }
    if (source.images.length) {
      lines.push("Images:");
      lines.push(...formatImages(source.images));
    }
    if (source.links.length) {
      lines.push("Page links:");
      lines.push(...formatLinks(source.links));
    }
  }

  const prompt = lines.join("\n");
  if (prompt.length <= maxChars) {
    return prompt;
  }

  return `${prompt.slice(0, maxChars - 80).trimEnd()}\n\n[Retrieval context truncated for prompt size.]`;
}

function normalizeRetrieveBody(body: unknown): RetrievalMessage[] {
  if (!body || typeof body !== "object") {
    return [];
  }

  const input = body as {
    query?: unknown;
    url?: unknown;
    messages?: unknown;
  };

  if (Array.isArray(input.messages)) {
    return input.messages
      .filter((message): message is { role?: unknown; content?: unknown } => {
        return Boolean(
          message &&
            typeof message === "object" &&
            typeof (message as { content?: unknown }).content === "string"
        );
      })
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.content)
      }));
  }

  const parts = [input.query, input.url]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return parts.length ? [{ role: "user", content: parts.join("\n") }] : [];
}

export async function handleRetrievalRequest(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const messages = normalizeRetrieveBody(req.body);
    const forceSearch =
      typeof req.body === "object" &&
      req.body !== null &&
      normalizeBoolean((req.body as { forceSearch?: unknown }).forceSearch, false);
    const forceFetch =
      typeof req.body === "object" &&
      req.body !== null &&
      normalizeBoolean((req.body as { forceFetch?: unknown }).forceFetch, false);
    const context = await collectRetrievalContext(messages, {
      forceSearch,
      forceFetch
    });

    res.json(context);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
