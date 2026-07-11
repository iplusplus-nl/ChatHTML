import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRetrievalHtmlSource,
  shouldRenderSpaFallback
} from "./retrievalHtmlParser.js";
import type { RetrievalConfig } from "./retrievalTypes.js";

const config: RetrievalConfig = {
  enabled: true,
  searchProvider: "none",
  searchMaxResults: 5,
  fetchMaxPages: 4,
  pageMaxChars: 10_000,
  contextMaxChars: 32_000,
  timeoutMs: 12_000,
  browserEngine: "fetch",
  allowDuckDuckGoFallback: true,
  allowPrivateUrls: false,
  maxLinksPerPage: 2,
  maxImagesPerPage: 2
};

test("parseRetrievalHtmlSource extracts canonical page content and bounded assets", () => {
  const source = parseRetrievalHtmlSource(
    {
      url: "https://example.com/start",
      finalUrl: "https://example.com/articles/page",
      status: 200,
      contentType: "text/html; charset=utf-8",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      html: `<!doctype html><html><head>
        <title>Fallback title</title>
        <meta property="og:title" content="  Primary   title  ">
        <meta name="description" content="A useful article">
        <meta property="og:image" content="/hero.jpg#fragment">
        <script>ignored()</script>
      </head><body><main>
        <h1>Heading</h1><p>First paragraph.</p><p>First paragraph.</p>
        <a href="/one">One</a><a href="/one#again">Duplicate</a><a href="mailto:x@y.test">Mail</a>
        <img src="/photo.jpg" alt="Photo" width="640" height="480">
        <source srcset="/small.jpg 1x, /large.jpg 2x">
      </main></body></html>`
    },
    config
  );

  assert.equal(source.title, "Primary title");
  assert.equal(source.text, "Heading First paragraph.");
  assert.equal(source.scriptCount, 1);
  assert.deepEqual(source.links, [
    { url: "https://example.com/one", text: "One" }
  ]);
  assert.deepEqual(
    source.images.map((image) => image.url),
    ["https://example.com/hero.jpg", "https://example.com/photo.jpg"]
  );
});

test("parseRetrievalHtmlSource retains seed metadata for bodyless responses", () => {
  const source = parseRetrievalHtmlSource(
    {
      url: "https://example.com/page",
      finalUrl: "https://example.com/page",
      status: 204,
      fetchedAt: "2026-01-01T00:00:00.000Z"
    },
    config,
    {
      url: "https://example.com/page",
      title: "Seed",
      imageUrl: "https://cdn.example.com/seed.jpg",
      provider: "test",
      rank: 2
    }
  );

  assert.equal(source.title, "Seed");
  assert.equal(source.images[0]?.url, "https://cdn.example.com/seed.jpg");
});

test("SPA fallback requires a successful HTML shell without useful content", () => {
  const shell = {
    status: 200,
    contentType: "text/html",
    htmlCharCount: 1_500,
    scriptCount: 3,
    bodyTextCharCount: 20,
    images: [],
    links: []
  };

  assert.equal(shouldRenderSpaFallback(shell), true);
  assert.equal(shouldRenderSpaFallback({ ...shell, status: 500 }), false);
  assert.equal(shouldRenderSpaFallback({ ...shell, text: "x".repeat(180) }), false);
  assert.equal(
    shouldRenderSpaFallback({ ...shell, images: [{ url: "https://x.test/a.jpg" }] }),
    false
  );
});
