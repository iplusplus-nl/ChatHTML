import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIframeBodyHtml,
  buildIframeDocument,
  getIframeThemeTokens
} from "./sandboxDocument";

describe("sandboxDocument", () => {
  it("creates day and night theme tokens", () => {
    assert.equal(getIframeThemeTokens("day").colorScheme, "light");
    assert.equal(getIframeThemeTokens("night").colorScheme, "dark");
  });

  it("wraps completed html in the sandbox document", () => {
    const document = buildIframeDocument("<p>Hello</p>", "day");

    assert.match(document, /^<!doctype html>/);
    assert.match(document, /Content-Security-Policy/);
    assert.match(document, /data-page-theme="day"/);
    assert.match(document, /<p>Hello<\/p>/);
    assert.match(document, /source: "streamui-runtime"/);
  });

  it("builds the same body html used by the live preview patcher", () => {
    const body = buildIframeBodyHtml("<p>Hello</p>");
    const document = buildIframeDocument("<p>Hello</p>");

    assert.match(body, /<p>Hello<\/p>/);
    assert.match(body, /streamui-performance-guard/);
    assert.match(document, new RegExp(body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("includes the prompt action bridge", () => {
    const document = buildIframeDocument(
      '<button data-streamui-prompt="Continue">Continue</button>'
    );

    assert.match(document, /data-streamui-prompt/);
    assert.match(document, /actionType: "prompt"/);
    assert.match(document, /post\("action"/);
  });

  it("includes the local capability action bridge", () => {
    const document = buildIframeDocument(
      '<button data-streamui-copy-target="#code">Copy</button><code id="code">x</code>'
    );

    assert.match(document, /data-streamui-copy/);
    assert.match(document, /data-streamui-download/);
    assert.match(document, /data-streamui-open-url/);
    assert.match(document, /actionType: "copy"/);
    assert.match(document, /actionType: "download"/);
    assert.match(document, /actionType: "open-url"/);
  });

  it("measures content bounds instead of the previous iframe viewport height", () => {
    const document = buildIframeDocument(
      "<details open><summary>More</summary><p>Text</p></details>"
    );

    assert.match(document, /getBoundingClientRect/);
    assert.doesNotMatch(document, /scrollHeight \|\| 0/);
    assert.doesNotMatch(document, /offsetHeight \|\| 0/);
  });
});
