import assert from "node:assert/strict";
import test from "node:test";
import {
  asksForRecentVisualResources,
  asksForVisualResources,
  buildRetrievalSearchQueries,
  extractRetrievalUrls,
  latestRetrievalUserText,
  prioritizeRetrievalSearchResults,
  shouldSearchRetrieval
} from "./retrievalPlanner.js";

test("extractRetrievalUrls normalizes web URLs, removes fragments, and deduplicates", () => {
  assert.deepEqual(
    extractRetrievalUrls(
      "Read https://example.com/a#part, www.example.org/path! then https://example.com/a#other"
    ),
    ["https://example.com/a", "https://www.example.org/path"]
  );
});

test("recent visual query planning targets social and video sources", () => {
  const request =
    "Create a gallery of photos and videos from today's GTC Rally. I like Japanese cars.";

  assert.equal(asksForRecentVisualResources(request, 2026), true);
  assert.deepEqual(buildRetrievalSearchQueries(request), [
    "photos and videos from today's GTC Rally",
    "photos and videos from today's GTC Rally site:instagram.com/p OR site:facebook.com/photos",
    "photos and videos from today's GTC Rally site:youtube.com/watch videos"
  ]);
});

test("retrieval planning distinguishes direct fetches from companion searches", () => {
  const urlOnly = "Read https://example.com/report";
  assert.equal(shouldSearchRetrieval(urlOnly, {}, true), false);
  assert.equal(
    shouldSearchRetrieval(`${urlOnly} and find related sources`, {}, true),
    true
  );
  assert.equal(shouldSearchRetrieval("write a static card", {}, false), false);
  assert.equal(shouldSearchRetrieval("latest browser release", {}, false), true);
  assert.equal(shouldSearchRetrieval("anything", { forceSearch: true }, false), true);
});

test("visual query planning strips creation boilerplate and adds visual sources", () => {
  const queries = buildRetrievalSearchQueries(
    "Please create a gallery of red pandas"
  );

  assert.equal(asksForVisualResources("请制作熊猫图片图库"), true);
  assert.deepEqual(queries, [
    "red pandas photos images",
    "red pandas photos images Wikimedia Commons",
    "red pandas photos images site:commons.wikimedia.org"
  ]);
});

test("latestRetrievalUserText ignores later assistant and blank user messages", () => {
  assert.equal(
    latestRetrievalUserText([
      { role: "user", content: " first request " },
      { role: "assistant", content: "answer" },
      { role: "user", content: "   " }
    ]),
    "first request"
  );
});

test("visual result prioritization favors first-party image providers stably", () => {
  const results = [
    { url: "https://stock.example/cats", provider: "web", rank: 1 },
    {
      url: "https://images.nasa.gov/details/cats",
      imageUrl: "https://images-assets.nasa.gov/cat.jpg",
      provider: "nasa",
      rank: 3
    },
    {
      url: "https://commons.wikimedia.org/wiki/File:Cat.jpg",
      provider: "duckduckgo",
      rank: 2
    }
  ];

  assert.deepEqual(
    prioritizeRetrievalSearchResults(results, "cat image gallery").map(
      (result) => result.url
    ),
    [results[1].url, results[2].url, results[0].url]
  );
  assert.equal(prioritizeRetrievalSearchResults(results, "write a card"), results);
});

test("recent visual result prioritization favors relevant social event pages", () => {
  const results = [
    {
      url: "https://www.metmuseum.org/art/collection/search/436964",
      title: "Young Lady in 1866",
      provider: "met",
      rank: 1
    },
    {
      url: "https://www.instagram.com/gtcrally/",
      title: "GTC Rally (@gtcrally) photos and videos",
      snippet: "GTC Rally 2026 on 10 and 11 July",
      provider: "duckduckgo",
      rank: 1
    },
    {
      url: "https://www.gtcrally.com/foto-s",
      title: "GTC Rally photos and videos",
      provider: "duckduckgo",
      rank: 2
    }
  ];

  assert.deepEqual(
    prioritizeRetrievalSearchResults(
      results,
      "latest GTC Rally 2026 photos and videos"
    ).map((result) => result.url),
    [results[1].url, results[2].url, results[0].url]
  );
});
