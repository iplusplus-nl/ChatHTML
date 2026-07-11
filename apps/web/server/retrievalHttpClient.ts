import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import type { RequestInit as UndiciRequestInit } from "undici";
import {
  createRetrievalOperationSignal,
  rethrowIfRetrievalAborted,
  throwIfRetrievalAborted
} from "./retrievalAbort.js";
import {
  assertPublicRetrievalUrl,
  getRetrievalHostname,
  matchesRetrievalDomain,
  resolveRetrievalUrlTarget,
  RetrievalUrlPolicyError,
  type RetrievalDnsAddress,
  type RetrievalDnsLookup,
  type RetrievalUrlPolicyConfig
} from "./retrievalUrlPolicy.js";

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type RetrievalHttpConfig = RetrievalUrlPolicyConfig & {
  timeoutMs: number;
  pageMaxChars: number;
  signal?: AbortSignal;
};

export type RetrievalPageFetchResult = {
  url: string;
  finalUrl: string;
  status?: number;
  contentType?: string;
  html?: string;
  fetchedAt: string;
};

export type RetrievalFetch = typeof globalThis.fetch;

export type RetrievalHttpDependencies = {
  fetchImpl?: RetrievalFetch;
  pinnedFetchImpl?(
    url: string,
    init: RequestInit,
    addresses: readonly RetrievalDnsAddress[]
  ): Promise<globalThis.Response>;
  lookup?: RetrievalDnsLookup;
  maxRedirects?: number;
  loadPlaywright?: RetrievalPlaywrightLoader;
};

export type ValidatedFetchResult = {
  response: globalThis.Response;
  finalUrl: string;
  redirectsFollowed: number;
};

export class RetrievalRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalRedirectError";
  }
}

function canonicalHttpUrl(value: string, baseUrl?: string): string {
  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    throw new RetrievalRedirectError("Retrieval redirect URL is invalid.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function redirectedRequestInit(
  init: RequestInit,
  status: number,
  fromUrl: string,
  toUrl: string
): RequestInit {
  const next: RequestInit = { ...init, redirect: "manual" };
  const method = (next.method ?? "GET").toUpperCase();
  if (
    (status === 303 && method !== "HEAD") ||
    ((status === 301 || status === 302) && method === "POST")
  ) {
    next.method = "GET";
    delete next.body;
  }

  const headers = new Headers(next.headers);
  if (new URL(fromUrl).origin !== new URL(toUrl).origin) {
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("proxy-authorization");
  }
  if (!next.body) {
    headers.delete("content-length");
    headers.delete("content-type");
  }
  next.headers = headers;
  return next;
}

async function cancelResponseBody(response: globalThis.Response) {
  if (response.body) {
    await response.body.cancel().catch(() => undefined);
  }
}

function pinnedLookupError(hostname: string): NodeJS.ErrnoException {
  const error = new Error(
    `No validated address is available for ${hostname}.`
  ) as NodeJS.ErrnoException;
  error.code = "ENOTFOUND";
  return error;
}

/**
 * Creates a connector lookup that can only return the addresses produced by
 * the URL policy. It never performs a second DNS query.
 */
export function createPinnedRetrievalLookup(
  addresses: readonly RetrievalDnsAddress[]
): LookupFunction {
  const validated = addresses.map(({ address, family }) => ({
    address,
    family
  }));

  return (hostname, options, callback) => {
    const requestedFamily = options.family;
    const eligible = validated.filter(
      ({ family }) => !requestedFamily || requestedFamily === family
    );
    if (!eligible.length) {
      callback(pinnedLookupError(hostname), "", 0);
      return;
    }

    if (options.all) {
      callback(null, eligible);
      return;
    }

    const selected = eligible[0];
    callback(null, selected.address, selected.family);
  };
}

async function closeDispatcher(agent: Agent): Promise<void> {
  try {
    await agent.close();
  } catch {
    await agent.destroy().catch(() => undefined);
  }
}

function responseWithDispatcherLifetime(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  agent: Agent
): globalThis.Response {
  const headers = Array.from(response.headers.entries());
  if (!response.body) {
    void closeDispatcher(agent);
    return new globalThis.Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  const reader = response.body.getReader();
  let released = false;
  const release = async (destroy = false) => {
    if (released) {
      return;
    }
    released = true;
    if (destroy) {
      await agent.destroy().catch(() => undefined);
      return;
    }
    await closeDispatcher(agent);
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          await release();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        await release(true);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await release();
      }
    }
  });

  return new globalThis.Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchWithPinnedRetrievalTarget(
  url: string,
  init: RequestInit,
  addresses: readonly RetrievalDnsAddress[]
): Promise<globalThis.Response> {
  if (!addresses.length) {
    throw new RetrievalUrlPolicyError(
      "Retrieval target has no validated network address."
    );
  }

  const agent = new Agent({
    autoSelectFamily: true,
    connect: {
      lookup: createPinnedRetrievalLookup(addresses)
    }
  });
  try {
    const response = await undiciFetch(url, {
      ...init,
      headers: Array.from(new Headers(init.headers).entries()),
      dispatcher: agent
    } as UndiciRequestInit);
    return responseWithDispatcherLifetime(response, agent);
  } catch (error) {
    await agent.destroy().catch(() => undefined);
    throw error;
  }
}

/**
 * Fetches a URL without delegating redirect handling to the runtime. Every
 * destination is validated immediately before it can cause a network request.
 */
export async function fetchWithValidatedRedirects(
  url: string,
  init: RequestInit,
  policy: RetrievalUrlPolicyConfig,
  dependencies: RetrievalHttpDependencies = {}
): Promise<ValidatedFetchResult> {
  const maxRedirects = dependencies.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new RetrievalRedirectError("Retrieval redirect limit is invalid.");
  }

  let currentUrl = canonicalHttpUrl(url);
  let currentInit: RequestInit = { ...init, redirect: "manual" };
  let redirectsFollowed = 0;
  const visited = new Set<string>([currentUrl]);

  while (true) {
    throwIfRetrievalAborted(currentInit.signal ?? undefined);
    const target = await resolveRetrievalUrlTarget(currentUrl, policy, {
      lookup: dependencies.lookup
    });
    throwIfRetrievalAborted(currentInit.signal ?? undefined);

    const response = dependencies.fetchImpl
      ? await dependencies.fetchImpl(currentUrl, currentInit)
      : policy.allowPrivateUrls
        ? await globalThis.fetch(currentUrl, currentInit)
        : await (dependencies.pinnedFetchImpl ?? fetchWithPinnedRetrievalTarget)(
            currentUrl,
            currentInit,
            target.addresses
          );
    try {
      throwIfRetrievalAborted(currentInit.signal ?? undefined);
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    const location = response.headers.get("location");
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return { response, finalUrl: currentUrl, redirectsFollowed };
    }

    const nextUrl = canonicalHttpUrl(location, currentUrl);
    if (visited.has(nextUrl)) {
      await cancelResponseBody(response);
      throw new RetrievalRedirectError("Retrieval redirect loop detected.");
    }
    if (redirectsFollowed >= maxRedirects) {
      await cancelResponseBody(response);
      throw new RetrievalRedirectError("Retrieval redirect limit exceeded.");
    }

    currentInit = redirectedRequestInit(
      currentInit,
      response.status,
      currentUrl,
      nextUrl
    );
    await cancelResponseBody(response);
    visited.add(nextUrl);
    currentUrl = nextUrl;
    redirectsFollowed += 1;
  }
}

export function isLikelyRetrievalHtml(
  contentType: string | undefined
): boolean {
  if (!contentType) {
    return true;
  }

  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml") ||
    contentType.includes("text/plain")
  );
}

export async function readBoundedResponseBody(
  response: globalThis.Response,
  maxBytes: number
): Promise<string> {
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

  if (received >= maxBytes) {
    await reader.cancel().catch(() => undefined);
    text += decoder.decode();
  }

  return text;
}

export async function fetchRetrievalPageWithNode(
  url: string,
  config: RetrievalHttpConfig,
  userAgent: string,
  dependencies: RetrievalHttpDependencies = {}
): Promise<RetrievalPageFetchResult> {
  const { response, finalUrl } = await fetchWithValidatedRedirects(
    url,
    {
      signal: createRetrievalOperationSignal(config.timeoutMs, config.signal),
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
        "User-Agent": userAgent
      }
    },
    config,
    dependencies
  );
  const contentType = response.headers.get("content-type") ?? undefined;

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`Fetch failed with HTTP ${response.status}.`);
  }

  if (!isLikelyRetrievalHtml(contentType)) {
    await cancelResponseBody(response);
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
    html: await readBoundedResponseBody(response, config.pageMaxChars * 8),
    fetchedAt: new Date().toISOString()
  };
}

export type PlaywrightRequestLike = {
  url(): string;
  isNavigationRequest?(): boolean;
  resourceType?(): string;
};

export type PlaywrightRouteLike = {
  request(): PlaywrightRequestLike;
  continue(): Promise<unknown>;
  abort(errorCode?: string): Promise<unknown>;
};

export type PlaywrightGuardResult =
  | { outcome: "continued"; url: string }
  | { outcome: "blocked"; url: string; error: unknown };

type RetrievalPlaywrightResponse = {
  headers(): Record<string, string>;
  status(): number;
};

type RetrievalPlaywrightPage = {
  setDefaultNavigationTimeout(timeoutMs: number): void;
  route(
    pattern: string,
    handler: (route: PlaywrightRouteLike) => Promise<void>
  ): Promise<unknown>;
  goto(
    url: string,
    options: { waitUntil: string; timeout: number }
  ): Promise<RetrievalPlaywrightResponse | null>;
  waitForLoadState(
    state: string,
    options: { timeout: number }
  ): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
};

type RetrievalPlaywrightBrowser = {
  newPage(options: Record<string, unknown>): Promise<RetrievalPlaywrightPage>;
  close(): Promise<void>;
};

type RetrievalPlaywright = {
  chromium: {
    launch(options: { headless: boolean }): Promise<RetrievalPlaywrightBrowser>;
  };
};

export type RetrievalPlaywrightLoader = () => Promise<RetrievalPlaywright>;

const loadRetrievalPlaywright: RetrievalPlaywrightLoader = async () => {
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<unknown>;
  return (await dynamicImport("playwright")) as RetrievalPlaywright;
};

export function createPlaywrightRetrievalRequestGuard(
  policy: RetrievalUrlPolicyConfig,
  dependencies: Pick<RetrievalHttpDependencies, "lookup"> = {},
  onResult?: (result: PlaywrightGuardResult) => void
): (route: PlaywrightRouteLike) => Promise<void> {
  return async (route) => {
    const url = route.request().url();
    try {
      await assertPublicRetrievalUrl(url, policy, {
        lookup: dependencies.lookup
      });
      await route.continue();
      onResult?.({ outcome: "continued", url });
    } catch (error) {
      await route.abort("blockedbyclient");
      onResult?.({ outcome: "blocked", url, error });
    }
  };
}

export async function fetchRetrievalPageWithPlaywright(
  url: string,
  config: RetrievalHttpConfig,
  userAgent: string,
  dependencies: Pick<
    RetrievalHttpDependencies,
    "lookup" | "loadPlaywright"
  > = {}
): Promise<RetrievalPageFetchResult> {
  if (!config.allowPrivateUrls) {
    throw new RetrievalUrlPolicyError(
      "Playwright retrieval is disabled while private URLs are blocked."
    );
  }
  await assertPublicRetrievalUrl(url, config, {
    lookup: dependencies.lookup
  });
  throwIfRetrievalAborted(config.signal);
  const playwright = await (dependencies.loadPlaywright ??
    loadRetrievalPlaywright)();
  throwIfRetrievalAborted(config.signal);
  const browser = await playwright.chromium.launch({ headless: true });
  let closePromise: Promise<void> | undefined;
  const closeBrowser = () => {
    closePromise ??= browser.close().catch(() => undefined);
    return closePromise;
  };
  const closeOnAbort = () => {
    void closeBrowser();
  };
  config.signal?.addEventListener("abort", closeOnAbort, { once: true });

  try {
    throwIfRetrievalAborted(config.signal);
    const page = await browser.newPage({
      userAgent,
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block"
    });
    page.setDefaultNavigationTimeout(config.timeoutMs);
    await page.route(
      "**/*",
      createPlaywrightRetrievalRequestGuard(config, dependencies)
    );
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(3_000, config.timeoutMs)
      })
      .catch(() => undefined);
    throwIfRetrievalAborted(config.signal);

    const finalUrl = page.url() || url;
    await assertPublicRetrievalUrl(finalUrl, config, {
      lookup: dependencies.lookup
    });
    const html = await page.content();
    throwIfRetrievalAborted(config.signal);
    const headers = response?.headers() ?? {};

    return {
      url,
      finalUrl,
      status: response?.status(),
      contentType: headers["content-type"],
      html: html.slice(0, config.pageMaxChars * 8),
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    rethrowIfRetrievalAborted(error, config.signal);
    throw error;
  } finally {
    config.signal?.removeEventListener("abort", closeOnAbort);
    await closeBrowser();
  }
}

function responseLooksLikeImage(response: globalThis.Response): {
  ok: boolean;
  contentType?: string;
} {
  const contentType = response.headers.get("content-type") ?? undefined;
  return {
    ok: response.ok && Boolean(contentType?.toLowerCase().startsWith("image/")),
    contentType
  };
}

function imageRequestReferer(url: string): string | undefined {
  const hostname = getRetrievalHostname(url);
  if (!hostname) {
    return undefined;
  }

  if (matchesRetrievalDomain(hostname, "artic.edu")) {
    return "https://www.artic.edu/";
  }

  return undefined;
}

function isRetrievalSafetyError(error: unknown): boolean {
  return (
    error instanceof RetrievalUrlPolicyError ||
    error instanceof RetrievalRedirectError
  );
}

export async function validateRetrievalImageUrl(
  url: string,
  config: RetrievalHttpConfig,
  userAgent: string,
  dependencies: RetrievalHttpDependencies = {}
): Promise<{ url: string; contentType?: string } | null> {
  const headers: Record<string, string> = {
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "User-Agent": userAgent
  };
  const referer = imageRequestReferer(url);
  if (referer) {
    headers.Referer = referer;
  }
  const timeoutMs = Math.min(config.timeoutMs, 8_000);

  try {
    const { response, finalUrl } = await fetchWithValidatedRedirects(
      url,
      {
        method: "HEAD",
        signal: createRetrievalOperationSignal(timeoutMs, config.signal),
        headers
      },
      config,
      dependencies
    );
    const result = responseLooksLikeImage(response);
    await cancelResponseBody(response);
    if (result.ok) {
      return { url: finalUrl, contentType: result.contentType };
    }
  } catch (error) {
    rethrowIfRetrievalAborted(error, config.signal);
    if (isRetrievalSafetyError(error)) {
      throw error;
    }
    // Some image hosts do not support HEAD. Fall back to a tiny ranged GET.
  }

  const { response, finalUrl } = await fetchWithValidatedRedirects(
    url,
    {
      method: "GET",
      signal: createRetrievalOperationSignal(timeoutMs, config.signal),
      headers: {
        ...headers,
        Range: "bytes=0-0"
      }
    },
    config,
    dependencies
  );
  const result = responseLooksLikeImage(response);
  await cancelResponseBody(response);

  return result.ok
    ? { url: finalUrl, contentType: result.contentType }
    : null;
}
