import assert from "node:assert/strict";
import test from "node:test";
import {
  searchRetrievalImageSources,
  type RetrievalImageProvider
} from "./retrievalImageProviders.js";
import type { RetrievalConfig } from "./retrievalTypes.js";

const config: RetrievalConfig = {
  enabled: true,
  searchProvider: "auto",
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

test("image provider orchestration skips missing keys and continues after failure", async () => {
  const called: string[] = [];
  const providers: RetrievalImageProvider[] = [
    {
      name: "Keyed",
      envKeys: ["MISSING_KEY"],
      search: async () => {
        called.push("keyed");
        return [];
      }
    },
    {
      name: "Broken",
      search: async () => {
        called.push("broken");
        throw new Error("offline");
      }
    },
    {
      name: "Working",
      search: async (query) => {
        called.push(query);
        return [
          {
            url: "https://example.com/photo",
            imageUrl: "https://cdn.example.com/photo.jpg",
            provider: "working",
            rank: 1
          },
          {
            url: "https://example.com/photo/",
            imageUrl: "https://cdn.example.com/duplicate.jpg",
            provider: "working",
            rank: 2
          }
        ];
      }
    }
  ];
  const notes: string[] = [];

  const results = await searchRetrievalImageSources(
    "cats site:commons.wikimedia.org Wikimedia Commons",
    config,
    notes,
    undefined,
    providers,
    {}
  );

  assert.deepEqual(called, ["broken", "cats"]);
  assert.equal(results.length, 1);
  assert.match(notes[0], /MISSING_KEY/);
  assert.equal(notes[1], "Broken image search failed: offline");
});
