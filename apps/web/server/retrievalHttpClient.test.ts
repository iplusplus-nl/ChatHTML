import assert from "node:assert/strict";
import test from "node:test";
import {
  createPinnedRetrievalLookup,
  createPlaywrightRetrievalRequestGuard,
  fetchRetrievalPageWithNode,
  fetchRetrievalPageWithPlaywright,
  fetchWithValidatedRedirects,
  RetrievalRedirectError,
  validateRetrievalImageUrl,
  type PlaywrightGuardResult,
  type PlaywrightRouteLike,
  type RetrievalFetch,
  type RetrievalHttpConfig
} from "./retrievalHttpClient.js";
import { RetrievalUrlPolicyError } from "./retrievalUrlPolicy.js";

const config: RetrievalHttpConfig = {
  allowPrivateUrls: false,
  timeoutMs: 2_000,
  pageMaxChars: 10_000
};

const publicLookup = async () => [
  { address: "93.184.216.34", family: 4 as const }
];

function scriptedFetch(
  handler: (url: string, init: RequestInit, call: number) => Response
): { fetchImpl: RetrievalFetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (
    input: string | URL | globalThis.Request,
    init?: RequestInit
  ) => {
    const url = input instanceof globalThis.Request ? input.url : input.toString();
    const normalizedInit = init ?? {};
    calls.push({ url, init: normalizedInit });
    return handler(url, normalizedInit, calls.length - 1);
  }) as RetrievalFetch;
  return { fetchImpl, calls };
}

test("validated fetch follows relative and multi-hop redirects manually", async () => {
  const { fetchImpl, calls } = scriptedFetch((url, _init, call) => {
    if (call === 0) {
      assert.equal(url, "https://public.example/start");
      return new Response(null, {
        status: 302,
        headers: { Location: "/next" }
      });
    }
    if (call === 1) {
      assert.equal(url, "https://public.example/next");
      return new Response(null, {
        status: 307,
        headers: { Location: "https://cdn.example/final" }
      });
    }
    assert.equal(url, "https://cdn.example/final");
    return new Response("done", { status: 200 });
  });

  const result = await fetchWithValidatedRedirects(
    "https://public.example/start#fragment",
    { headers: { Authorization: "secret", Cookie: "session=1" } },
    config,
    { fetchImpl, lookup: publicLookup }
  );

  assert.equal(result.finalUrl, "https://cdn.example/final");
  assert.equal(result.redirectsFollowed, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.init.redirect === "manual"));
  const finalHeaders = new Headers(calls[2].init.headers);
  assert.equal(finalHeaders.has("authorization"), false);
  assert.equal(finalHeaders.has("cookie"), false);
});

test("validated fetch blocks a public-to-private redirect before the private request", async () => {
  const { fetchImpl, calls } = scriptedFetch(() =>
    new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1:8787/admin" }
    })
  );

  await assert.rejects(
    fetchWithValidatedRedirects(
      "https://public.example/start",
      {},
      config,
      { fetchImpl, lookup: publicLookup }
    ),
    RetrievalUrlPolicyError
  );
  assert.equal(calls.length, 1);
});

test("validated fetch reruns DNS and domain policy for every redirect hop", async () => {
  const { fetchImpl, calls } = scriptedFetch(() =>
    new Response(null, {
      status: 302,
      headers: { Location: "https://private-dns.example/internal" }
    })
  );
  const lookedUp: string[] = [];

  await assert.rejects(
    fetchWithValidatedRedirects(
      "https://public.example/start",
      {},
      config,
      {
        fetchImpl,
        lookup: async (hostname) => {
          lookedUp.push(hostname);
          return [
            {
              address:
                hostname === "private-dns.example"
                  ? "192.168.1.10"
                  : "93.184.216.34",
              family: 4
            }
          ];
        }
      }
    ),
    RetrievalUrlPolicyError
  );
  assert.deepEqual(lookedUp, ["public.example", "private-dns.example"]);
  assert.equal(calls.length, 1);

  await assert.rejects(
    fetchWithValidatedRedirects(
      "https://public.example/start",
      {},
      { ...config, allowedDomains: ["public.example"] },
      { fetchImpl, lookup: publicLookup }
    ),
    /domain controls/
  );
});

test("strict fetch pins the policy result without a second DNS resolution", async () => {
  let lookupCalls = 0;
  const connectedAddresses: string[][] = [];

  const result = await fetchWithValidatedRedirects(
    "https://rebind.example/page",
    {},
    config,
    {
      lookup: async () => {
        lookupCalls += 1;
        return lookupCalls === 1
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }];
      },
      pinnedFetchImpl: async (_url, _init, addresses) => {
        connectedAddresses.push(addresses.map(({ address }) => address));
        return new Response("safe", { status: 200 });
      }
    }
  );

  assert.equal(result.response.status, 200);
  assert.equal(lookupCalls, 1);
  assert.deepEqual(connectedAddresses, [["93.184.216.34"]]);
});

test("pinned connector lookup returns only prevalidated addresses", async () => {
  const lookup = createPinnedRetrievalLookup([
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
  ]);
  const resolved = await new Promise<{
    address: string | import("node:dns").LookupAddress[];
    family?: number;
  }>((resolve, reject) => {
    lookup(
      "rebind.example",
      { family: 4, all: false },
      (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ address, family });
      }
    );
  });

  assert.deepEqual(resolved, { address: "93.184.216.34", family: 4 });
});

test("validated fetch rejects redirect loops without repeating a request", async () => {
  const { fetchImpl, calls } = scriptedFetch((url) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: url.endsWith("/a") ? "/b" : "/a"
      }
    })
  );

  await assert.rejects(
    fetchWithValidatedRedirects(
      "https://public.example/a",
      {},
      config,
      { fetchImpl, lookup: publicLookup }
    ),
    (error) =>
      error instanceof RetrievalRedirectError && /loop/.test(error.message)
  );
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://public.example/a", "https://public.example/b"]
  );
});

test("validated fetch enforces a finite redirect limit", async () => {
  const { fetchImpl, calls } = scriptedFetch((_url, _init, call) =>
    new Response(null, {
      status: 302,
      headers: { Location: `/hop-${call + 1}` }
    })
  );

  await assert.rejects(
    fetchWithValidatedRedirects(
      "https://public.example/start",
      {},
      config,
      { fetchImpl, lookup: publicLookup, maxRedirects: 2 }
    ),
    (error) =>
      error instanceof RetrievalRedirectError && /limit/.test(error.message)
  );
  assert.equal(calls.length, 3);
});

test("node page fetch reports the manually validated final URL", async () => {
  const { fetchImpl } = scriptedFetch((_url, _init, call) =>
    call === 0
      ? new Response(null, {
          status: 301,
          headers: { Location: "/article" }
        })
      : new Response("<main>safe</main>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        })
  );

  const result = await fetchRetrievalPageWithNode(
    "https://public.example/",
    config,
    "test-agent",
    { fetchImpl, lookup: publicLookup }
  );
  assert.equal(result.finalUrl, "https://public.example/article");
  assert.equal(result.html, "<main>safe</main>");
});

test("node page fetch immediately aborts an in-flight fetch from the run signal", async () => {
  const controller = new AbortController();
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let markFetchAborted: (() => void) | undefined;
  const fetchAborted = new Promise<void>((resolve) => {
    markFetchAborted = resolve;
  });
  const fetchImpl = (async (
    _input: string | URL | globalThis.Request,
    init?: RequestInit
  ) => {
    const signal = init?.signal;
    assert.ok(signal);
    markStarted?.();
    return new Promise<Response>((_resolve, reject) => {
      const rejectFromSignal = () => {
        markFetchAborted?.();
        reject(signal.reason);
      };
      if (signal.aborted) {
        rejectFromSignal();
        return;
      }
      signal.addEventListener("abort", rejectFromSignal, { once: true });
    });
  }) as RetrievalFetch;

  const pending = fetchRetrievalPageWithNode(
    "https://public.example/blocked",
    { ...config, signal: controller.signal },
    "test-agent",
    { fetchImpl, lookup: publicLookup }
  );
  await started;
  controller.abort();
  await Promise.race([
    fetchAborted,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("fetch did not abort promptly")), 250)
    )
  ]);
  await assert.rejects(
    pending,
    (error) => error instanceof Error && error.name === "AbortError"
  );
});

test("image HEAD redirects are subject to the same private URL policy", async () => {
  const { fetchImpl, calls } = scriptedFetch(() =>
    new Response(null, {
      status: 302,
      headers: { Location: "http://[::ffff:127.0.0.1]/secret.png" }
    })
  );

  await assert.rejects(
    validateRetrievalImageUrl(
      "https://images.example/start.png",
      config,
      "image-agent",
      { fetchImpl, lookup: publicLookup }
    ),
    RetrievalUrlPolicyError
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "HEAD");
});

test("image validation safely falls back from HEAD to a ranged redirected GET", async () => {
  const { fetchImpl, calls } = scriptedFetch((_url, init, call) => {
    if (call === 0) {
      assert.equal(init.method, "HEAD");
      return new Response(null, { status: 405 });
    }
    if (call === 1) {
      assert.equal(init.method, "GET");
      return new Response(null, {
        status: 302,
        headers: { Location: "/final.png" }
      });
    }
    return new Response(new Uint8Array([137]), {
      status: 206,
      headers: { "Content-Type": "image/png" }
    });
  });

  const result = await validateRetrievalImageUrl(
    "https://images.example/start.png",
    config,
    "image-agent",
    { fetchImpl, lookup: publicLookup }
  );
  assert.deepEqual(result, {
    url: "https://images.example/final.png",
    contentType: "image/png"
  });
  assert.equal(new Headers(calls[1].init.headers).get("range"), "bytes=0-0");
});

function fakeRoute(url: string, resourceType: string) {
  let continued = 0;
  let aborted = 0;
  const route: PlaywrightRouteLike = {
    request: () => ({
      url: () => url,
      resourceType: () => resourceType,
      isNavigationRequest: () => resourceType === "document"
    }),
    continue: async () => {
      continued += 1;
    },
    abort: async () => {
      aborted += 1;
    }
  };
  return {
    route,
    counts: () => ({ continued, aborted })
  };
}

test("Playwright guard validates both main navigation and subresources", async () => {
  const results: PlaywrightGuardResult[] = [];
  const guard = createPlaywrightRetrievalRequestGuard(
    config,
    { lookup: publicLookup },
    (result) => results.push(result)
  );
  const main = fakeRoute("https://public.example/page", "document");
  const publicImage = fakeRoute("https://cdn.example/image.png", "image");
  const privateScript = fakeRoute("http://127.0.0.1/internal.js", "script");
  const mappedNavigation = fakeRoute(
    "http://[::ffff:7f00:1]/admin",
    "document"
  );

  await guard(main.route);
  await guard(publicImage.route);
  await guard(privateScript.route);
  await guard(mappedNavigation.route);

  assert.deepEqual(main.counts(), { continued: 1, aborted: 0 });
  assert.deepEqual(publicImage.counts(), { continued: 1, aborted: 0 });
  assert.deepEqual(privateScript.counts(), { continued: 0, aborted: 1 });
  assert.deepEqual(mappedNavigation.counts(), { continued: 0, aborted: 1 });
  assert.deepEqual(
    results.map((result) => result.outcome),
    ["continued", "continued", "blocked", "blocked"]
  );
});

test("strict retrieval rejects Playwright before lookup or browser launch", async () => {
  let lookups = 0;
  await assert.rejects(
    fetchRetrievalPageWithPlaywright(
      "https://public.example/page",
      config,
      "test-agent",
      {
        lookup: async () => {
          lookups += 1;
          return publicLookup();
        }
      }
    ),
    /Playwright retrieval is disabled/
  );
  assert.equal(lookups, 0);
});

test("Playwright retrieval closes the browser when the run signal aborts", async () => {
  const controller = new AbortController();
  let markNavigationStarted: (() => void) | undefined;
  const navigationStarted = new Promise<void>((resolve) => {
    markNavigationStarted = resolve;
  });
  let rejectNavigation: ((error: Error) => void) | undefined;
  let closeCalls = 0;
  const browser = {
    newPage: async () => ({
      setDefaultNavigationTimeout: () => undefined,
      route: async () => undefined,
      goto: async () => {
        markNavigationStarted?.();
        return new Promise<never>((_resolve, reject) => {
          rejectNavigation = reject;
        });
      },
      waitForLoadState: async () => undefined,
      url: () => "https://public.example/page",
      content: async () => "<main>never reached</main>"
    }),
    close: async () => {
      closeCalls += 1;
      rejectNavigation?.(new Error("browser closed"));
    }
  };

  const pending = fetchRetrievalPageWithPlaywright(
    "https://public.example/page",
    { ...config, allowPrivateUrls: true, signal: controller.signal },
    "test-agent",
    {
      loadPlaywright: async () => ({
        chromium: { launch: async () => browser }
      })
    }
  );

  await navigationStarted;
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(closeCalls, 1);
});
