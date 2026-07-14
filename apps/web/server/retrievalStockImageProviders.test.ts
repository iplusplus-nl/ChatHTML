import assert from "node:assert/strict";
import test from "node:test";
import { tavilyImageSearchResults } from "./retrievalStockImageProviders.js";

test("Tavily keeps curated top-level image results without nested matches", () => {
  const results = tavilyImageSearchResults({
    images: [
      {
        url: "https://cdn.example.com/wrx-front.jpg",
        title: "Subaru WRX gallery",
        description: "Blue Subaru WRX from the front"
      },
      {
        url: "https://cdn.example.com/wrx-rear.jpg",
        title: "Subaru WRX gallery",
        description: "Blue Subaru WRX from the rear"
      }
    ],
    results: [
      {
        url: "https://example.com/subaru-wrx-gallery",
        title: "Subaru WRX gallery"
      }
    ]
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.provider === "tavily-images"));
  assert.ok(
    results.every(
      (result) => result.url === "https://example.com/subaru-wrx-gallery"
    )
  );
  assert.deepEqual(
    results.map((result) => result.imageUrl),
    [
      "https://cdn.example.com/wrx-front.jpg",
      "https://cdn.example.com/wrx-rear.jpg"
    ]
  );
});

test("Tavily prefers curated images and deduplicates nested page assets", () => {
  const results = tavilyImageSearchResults({
    images: [
      {
        url: "https://cdn.example.com/featured.jpg",
        title: "Official WRX photos"
      }
    ],
    results: [
      {
        url: "https://example.com/wrx",
        title: "Official WRX photos",
        images: [
          "https://cdn.example.com/featured.jpg",
          "https://cdn.example.com/second.jpg"
        ]
      }
    ]
  });

  assert.deepEqual(
    results.map((result) => result.imageUrl),
    [
      "https://cdn.example.com/featured.jpg",
      "https://cdn.example.com/second.jpg"
    ]
  );
});
