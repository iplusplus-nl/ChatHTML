import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRetrievalImageCandidates,
  retrievalImageDedupeKey,
  retrievalImageUrlVariants,
  verifyRetrievalImageCandidates
} from "./retrievalImageVerification.js";
import type {
  RetrievalConfig,
  RetrievalSource
} from "./retrievalTypes.js";

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
  maxLinksPerPage: 24,
  maxImagesPerPage: 18
};

function source(images: RetrievalSource["images"]): RetrievalSource {
  return {
    id: 4,
    kind: "page",
    url: "https://example.com/cats",
    finalUrl: "https://example.com/cats/final",
    title: "Cat gallery",
    images,
    links: []
  };
}

test("candidate collection removes decorative and canonical URL duplicates", () => {
  const candidates = collectRetrievalImageCandidates(
    [
      source([
        { url: "https://cdn.example/cat.jpg?size=small", alt: "cat" },
        { url: "https://cdn.example/cat.jpg?size=large", alt: "cat duplicate" },
        { url: "https://cdn.example/logo.svg", alt: "logo" },
        { url: "https://cdn.example/dog.jpg", alt: "dog" }
      ])
    ],
    ["cat photos"]
  );

  assert.deepEqual(
    candidates.map((candidate) => candidate.image.url),
    [
      "https://cdn.example/cat.jpg?size=small",
      "https://cdn.example/dog.jpg"
    ]
  );
  assert.equal(
    retrievalImageDedupeKey("https://cdn.example/cat.jpg?a=1"),
    retrievalImageDedupeKey("https://cdn.example/cat.jpg?a=2")
  );
});

test("Wikimedia variants prefer a bounded display image before the source URL", () => {
  const original =
    "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg";
  assert.deepEqual(retrievalImageUrlVariants(original), [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/1280px-Example.jpg",
    original
  ]);
});

test("verification tries URL variants, preserves attribution, and records rejection", async () => {
  const notes: string[] = [];
  const attempted: string[] = [];
  const results = await verifyRetrievalImageCandidates(
    [
      source([
        {
          url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg",
          alt: "cat example",
          credit: "Example author"
        },
        { url: "https://cdn.example/rejected.jpg", alt: "cat reject" }
      ])
    ],
    ["cat images"],
    config,
    notes,
    undefined,
    async (url) => {
      attempted.push(url);
      if (url.endsWith("/1280px-Example.jpg")) {
        return { url, contentType: "image/jpeg" };
      }
      return null;
    }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.sourceId, 4);
  assert.equal(results[0]?.sourceUrl, "https://example.com/cats/final");
  assert.equal(results[0]?.credit, "Example author");
  assert.ok(attempted.some((url) => url.endsWith("rejected.jpg")));
  assert.deepEqual(notes, [
    "Image verification rejected 1 non-loadable candidate URLs."
  ]);
});
