import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  drawScreenshotLayers,
  type ScreenshotOverlayLayer
} from "./screenshotLayerComposition";

describe("screenshot layer composition", () => {
  it("draws isolated iframe images over the captured page at viewport coordinates", () => {
    const calls: unknown[][] = [];
    const baseImage = { name: "base" } as unknown as CanvasImageSource;
    const firstImage = { name: "first" } as unknown as CanvasImageSource;
    const secondImage = { name: "second" } as unknown as CanvasImageSource;
    const overlays: ScreenshotOverlayLayer[] = [
      { image: firstImage, left: 10, top: 20, width: 300, height: 120 },
      { image: secondImage, left: 25, top: 40, width: 80, height: 60 }
    ];

    drawScreenshotLayers(
      {
        setTransform: (...args) => calls.push(["transform", ...args]),
        drawImage: (...args) => calls.push(["image", ...args])
      },
      baseImage,
      900,
      700,
      2,
      overlays
    );

    assert.deepEqual(calls, [
      ["transform", 2, 0, 0, 2, 0, 0],
      ["image", baseImage, 0, 0, 900, 700],
      ["image", firstImage, 10, 20, 300, 120],
      ["image", secondImage, 25, 40, 80, 60]
    ]);
  });
});
