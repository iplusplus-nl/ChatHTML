import assert from "node:assert/strict";
import test from "node:test";
import {
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
