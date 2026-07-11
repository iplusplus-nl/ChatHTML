export type ScreenshotOverlayLayer<
  TImage extends CanvasImageSource = CanvasImageSource
> = {
  image: TImage;
  left: number;
  top: number;
  width: number;
  height: number;
};

type ScreenshotDrawContext = {
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number
  ): void;
};

export function drawScreenshotLayers(
  context: ScreenshotDrawContext,
  baseImage: CanvasImageSource,
  width: number,
  height: number,
  scale: number,
  overlays: readonly ScreenshotOverlayLayer[]
): void {
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.drawImage(baseImage, 0, 0, width, height);

  for (const overlay of overlays) {
    context.drawImage(
      overlay.image,
      overlay.left,
      overlay.top,
      overlay.width,
      overlay.height
    );
  }
}
