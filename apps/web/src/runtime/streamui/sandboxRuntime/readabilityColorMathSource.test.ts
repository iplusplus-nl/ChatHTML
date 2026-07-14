import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readabilityColorMathSource } from "./readabilityColorMathSource";

type Color = { r: number; g: number; b: number; a: number };

type ColorMath = {
  parseReadabilityColor(value: string): Color | null;
  compositeReadabilityColor(
    foreground: Color,
    background: Color
  ): Color | null;
  readabilityContrastRatio(first: Color, second: Color): number | null;
  serializeReadabilityColor(color: Color): string | null;
};

function colorMath(): ColorMath {
  return new Function(
    `${readabilityColorMathSource}\nreturn { parseReadabilityColor, compositeReadabilityColor, readabilityContrastRatio, serializeReadabilityColor };`
  )() as ColorMath;
}

describe("readability color math source", () => {
  it("parses computed rgb, alpha, hex, and color(srgb) values", () => {
    const math = colorMath();

    assert.deepEqual(math.parseReadabilityColor("rgb(10, 20, 30)"), {
      r: 10,
      g: 20,
      b: 30,
      a: 1
    });
    assert.deepEqual(math.parseReadabilityColor("rgb(100% 0% 0% / 50%)"), {
      r: 254.99999999999997,
      g: 0,
      b: 0,
      a: 0.5
    });
    assert.deepEqual(math.parseReadabilityColor("#1238"), {
      r: 17,
      g: 34,
      b: 51,
      a: 136 / 255
    });
    assert.deepEqual(math.parseReadabilityColor("color(srgb 0 0.5 1 / 0.25)"), {
      r: 0,
      g: 127.5,
      b: 255,
      a: 0.25
    });
    assert.deepEqual(math.parseReadabilityColor("color(srgb 0% 50% 100%)"), {
      r: 0,
      g: 127.5,
      b: 255,
      a: 1
    });
    assert.equal(math.parseReadabilityColor("url(#gradient)"), null);
  });

  it("composites alpha before measuring contrast", () => {
    const math = colorMath();
    const white = math.parseReadabilityColor("#fff")!;
    const black = math.parseReadabilityColor("#000")!;
    const translucentBlack = math.parseReadabilityColor("rgba(0,0,0,.5)")!;
    const composited = math.compositeReadabilityColor(translucentBlack, white)!;

    assert.equal(math.readabilityContrastRatio(black, white), 21);
    assert.ok(Math.abs(composited.r - 127.5) < 0.001);
    assert.ok((math.readabilityContrastRatio(composited, white) ?? 0) < 4.5);
    assert.equal(math.serializeReadabilityColor(composited), "rgb(128, 128, 128)");
  });
});
