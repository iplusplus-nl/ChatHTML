import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCoreSource } from "./coreSource";
import { diagnosticsSource } from "./diagnosticsSource";
import { measurementSource } from "./measurementSource";
import { readabilitySource } from "./readabilitySource";

describe("sandbox measurement lifecycle", () => {
  it("defers layout measurement and readability work until iframe load", () => {
    const core = buildCoreSource("https://example.test/mathjax.js", "token", "epoch");

    assert.match(core, /runtimeDocumentLoaded = document\.readyState === "complete"/);
    assert.match(core, /if \(!runtimeDocumentLoaded\) \{\s*return;/);
    assert.match(measurementSource, /const measure = \(forceShrink = false\)[\s\S]*if \(!runtimeDocumentLoaded\)/);
    assert.match(readabilitySource, /const scheduleReadabilityAudit = \(\) => \{\s*if \(!runtimeDocumentLoaded\)/);
  });

  it("forces a settled height update after replacing a failed image", () => {
    assert.match(diagnosticsSource, /image\.replaceWith\(fallback\);\s*scheduleMeasure\(true\)/);
    assert.match(measurementSource, /forceShrink && height < lastHeight/);
  });

  it("counts absolute content when the body establishes its containing block", () => {
    assert.match(
      measurementSource,
      /while \(parent && parent !== document\.documentElement\)[\s\S]*getComputedStyle\(parent\)\.position !== "static"[\s\S]*parent === body/
    );
  });
});
