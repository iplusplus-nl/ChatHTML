import assert from "node:assert/strict";
import test from "node:test";
import { shouldRenderSpaFallback } from "../../server/retrieval.js";

test("detects a likely SPA shell for Playwright fallback", () => {
  assert.equal(
    shouldRenderSpaFallback({
      status: 200,
      contentType: "text/html; charset=utf-8",
      htmlCharCount: 2_500,
      scriptCount: 3,
      bodyTextCharCount: 24,
      text: "ChatHTML",
      images: [],
      links: []
    }),
    true
  );
});

test("does not use Playwright fallback for ordinary static pages", () => {
  assert.equal(
    shouldRenderSpaFallback({
      status: 200,
      contentType: "text/html",
      htmlCharCount: 3_000,
      scriptCount: 1,
      bodyTextCharCount: 1_200,
      text: "This article has enough readable text to use directly.",
      images: [],
      links: [{ url: "https://example.com/about", text: "About" }]
    }),
    false
  );
});
