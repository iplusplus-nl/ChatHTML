import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readabilitySource } from "./readabilitySource";

describe("sandbox readability source", () => {
  it("compiles as browser JavaScript", () => {
    assert.doesNotThrow(() => new Function(readabilitySource));
  });

  it("audits comfortable floors without mutating artifact colors", () => {
    assert.match(readabilitySource, /READABILITY_TEXT_RATIO = 4\.5/);
    assert.match(readabilitySource, /READABILITY_GRAPHIC_RATIO = 3/);
    assert.match(readabilitySource, /data-streamui-decorative/);
    assert.match(readabilitySource, /svg-fill-contrast/);
    assert.match(readabilitySource, /svg-stroke-contrast/);
    assert.match(readabilitySource, /control-boundary-contrast/);
    assert.match(readabilitySource, /READABILITY_DEBOUNCE_MS = 350/);
    assert.match(readabilitySource, /READABILITY_MAX_WAIT_MS = 1500/);
    assert.match(readabilitySource, /isPreviewComplete\(\)/);
    assert.match(readabilitySource, /post\("readability"/);
    assert.match(readabilitySource, /CSS\.supports\("color", input\)/);
    assert.match(readabilitySource, /getImageData\(0, 0, 1, 1\)/);
    assert.match(readabilitySource, /cloneReadabilityColor/);
    assert.match(readabilitySource, /uncertainCompositingGroup/);
    assert.match(readabilitySource, /hasUnmeasuredReadabilityBackdrop/);
    assert.match(readabilitySource, /readabilityPseudoPaintsBackdrop/);
    assert.match(readabilitySource, /candidatePaintsAtPoint/);
    assert.match(readabilitySource, /document\.elementsFromPoint/);
    assert.match(readabilitySource, /nativeInputType/);
    assert.match(readabilitySource, /input\[type="submit"\]/);
    assert.match(readabilitySource, /fillIsStrong/);
    assert.match(readabilitySource, /graphic\.closest\("svg"\) !== svg/);
    assert.match(readabilitySource, /path, rect, circle, ellipse, line, polyline, polygon, use/);
    assert.doesNotMatch(readabilitySource, /style\.setProperty/);
    assert.doesNotMatch(readabilitySource, /!important/);
  });

  it("emits bounded stateful issue and clear reports", () => {
    assert.match(readabilitySource, /READABILITY_FINDING_LIMIT = 12/);
    assert.match(readabilitySource, /status = report\.findings\.length \? "issues" : "clear"/);
    assert.match(readabilitySource, /lastReadabilitySignature/);
    assert.match(readabilitySource, /count: report\.total/);
    assert.match(readabilitySource, /findings: report\.findings/);
    assert.match(readabilitySource, /truncated: report\.truncated/);
  });
});
