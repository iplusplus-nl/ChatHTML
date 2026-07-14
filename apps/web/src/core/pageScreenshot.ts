import { getIframeCaptureSource } from "./iframeCaptureSource";
import {
  drawScreenshotLayers,
  type ScreenshotOverlayLayer
} from "./screenshotLayerComposition";
import { inlineExternalSnapshotResources } from "./artifactExportResources";
import { elementToBrowserSvg } from "./browserDomToSvg";

const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_PIXELS = 32_000_000;
const SCREENSHOT_TIMEOUT_MS = 8_000;
const SVG_MIME_TYPE = "image/svg+xml;charset=utf-8";

type IframeOverlay = ScreenshotOverlayLayer<HTMLImageElement> & {
  cleanup(): void;
};

type IframeCaptureContext = {
  document: Document;
  window: Window;
  cleanup(): void;
};

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
}

async function settleWithin<T>(
  promise: Promise<T> | undefined,
  timeoutMs: number
): Promise<void> {
  if (!promise) {
    return;
  }

  await Promise.race([
    promise.then(() => undefined).catch(() => undefined),
    delay(timeoutMs)
  ]);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeoutId = 0;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getScreenshotScale(width: number, height: number): number {
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const dimensionScale = Math.min(
    MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height
  );
  const pixelScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  return Math.min(deviceScale, dimensionScale, pixelScale, 2);
}

function createCaptureArea(
  document: Document,
  x: number,
  y: number,
  width: number,
  height: number
): DOMRectReadOnly {
  const FrameDomRect = document.defaultView?.DOMRect ?? DOMRect;
  return new FrameDomRect(x, y, width, height);
}

async function renderDocumentAreaToSvg(
  document: Document,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<string> {
  const exclusionStyle = document.createElement("style");
  exclusionStyle.textContent =
    "[data-screenshot-exclude] { visibility: hidden !important; }";
  document.head.appendChild(exclusionStyle);
  let svgDocument: XMLDocument;
  try {
    svgDocument = elementToBrowserSvg(document.documentElement, {
      captureArea: createCaptureArea(document, x, y, width, height),
      keepLinks: false
    });
  } finally {
    exclusionStyle.remove();
  }
  await withTimeout(
    inlineExternalSnapshotResources(
      svgDocument.documentElement,
      document.baseURI
    ),
    SCREENSHOT_TIMEOUT_MS,
    "Timed out while inlining screenshot resources."
  ).catch((error) => {
    console.warn("Could not inline every screenshot resource.", error);
  });
  return new XMLSerializer().serializeToString(svgDocument.documentElement);
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  return withTimeout(
    new Promise<HTMLImageElement>((resolve, reject) => {
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error("Could not load the screenshot SVG.")),
        { once: true }
      );
      image.decoding = "async";
      image.src = url;
    }),
    SCREENSHOT_TIMEOUT_MS,
    "Timed out while loading the screenshot SVG."
  );
}

async function waitForImageElementReady(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) {
    await settleWithin(image.decode?.(), 1_000);
    return;
  }

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error("Could not load the iframe overlay image.")),
        { once: true }
      );
    }),
    SCREENSHOT_TIMEOUT_MS,
    "Timed out while loading the iframe overlay image."
  );
  await settleWithin(image.decode?.(), 1_000);
}

async function waitForDocumentImages(document: Document): Promise<void> {
  await Promise.all(
    Array.from(document.images).map((image) =>
      waitForImageElementReady(image).catch(() => undefined)
    )
  );
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return withTimeout(
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Could not encode the screenshot PNG."));
      }, "image/png");
    }),
    SCREENSHOT_TIMEOUT_MS,
    "Timed out while encoding the screenshot PNG."
  );
}

async function rasterizeSvgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale: number,
  overlays: readonly ScreenshotOverlayLayer[] = []
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: SVG_MIME_TYPE }));
  try {
    const image = await loadImageFromUrl(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create a canvas for the screenshot.");
    }

    drawScreenshotLayers(context, image, width, height, scale, overlays);
    return await canvasToPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderDocumentAreaToDataUrl(
  document: Document,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<string> {
  const svg = await renderDocumentAreaToSvg(
    document,
    x,
    y,
    width,
    height
  );
  const scale = getScreenshotScale(width, height);
  const blob = await rasterizeSvgToPngBlob(svg, width, height, scale);

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Could not encode the iframe screenshot."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Could not read the iframe screenshot."));
    });
    reader.readAsDataURL(blob);
  });
}

function rectIntersectsViewport(rect: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight
  );
}

function getDirectIframeCaptureContext(
  iframe: HTMLIFrameElement
): IframeCaptureContext | null {
  try {
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    if (!frameDocument?.documentElement || !frameWindow) {
      return null;
    }
    void frameWindow.scrollX;
    return {
      document: frameDocument,
      window: frameWindow,
      cleanup() {}
    };
  } catch {
    return null;
  }
}

async function createStaticIframeCaptureContext(
  iframe: HTMLIFrameElement,
  rect: DOMRect
): Promise<IframeCaptureContext | null> {
  const source = getIframeCaptureSource(iframe) ?? iframe.srcdoc;
  if (!source) {
    return null;
  }

  const proxy = document.createElement("iframe");
  proxy.setAttribute("aria-hidden", "true");
  proxy.setAttribute("sandbox", "allow-same-origin");
  proxy.style.position = "fixed";
  proxy.style.left = "-100000px";
  proxy.style.top = "0";
  proxy.style.width = `${Math.max(1, rect.width)}px`;
  proxy.style.height = `${Math.max(1, rect.height)}px`;
  proxy.style.border = "0";
  proxy.style.pointerEvents = "none";
  proxy.srcdoc = source;

  const loaded = new Promise<void>((resolve, reject) => {
    proxy.addEventListener("load", () => resolve(), { once: true });
    proxy.addEventListener(
      "error",
      () => reject(new Error("Could not load the static iframe capture.")),
      { once: true }
    );
  });
  document.body.appendChild(proxy);
  try {
    await withTimeout(
      loaded,
      SCREENSHOT_TIMEOUT_MS,
      "Timed out while loading the static iframe capture."
    );
    const frameDocument = proxy.contentDocument;
    const frameWindow = proxy.contentWindow;
    if (!frameDocument?.documentElement || !frameWindow) {
      proxy.remove();
      return null;
    }

    return {
      document: frameDocument,
      window: frameWindow,
      cleanup: () => proxy.remove()
    };
  } catch (error) {
    proxy.remove();
    throw error;
  }
}

async function getIframeCaptureContext(
  iframe: HTMLIFrameElement,
  rect: DOMRect
): Promise<IframeCaptureContext | null> {
  return (
    getDirectIframeCaptureContext(iframe) ??
    (await createStaticIframeCaptureContext(iframe, rect))
  );
}

async function createIframeOverlay(
  iframe: HTMLIFrameElement
): Promise<IframeOverlay | null> {
  const rect = iframe.getBoundingClientRect();
  if (!rectIntersectsViewport(rect)) {
    return null;
  }

  const capture = await getIframeCaptureContext(iframe, rect);
  if (!capture) {
    return null;
  }

  let overlay: HTMLImageElement | null = null;
  const previousVisibility = iframe.style.visibility;
  let iframeHidden = false;
  try {
    const visibleLeft = Math.max(0, rect.left);
    const visibleTop = Math.max(0, rect.top);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    const visibleWidth = Math.max(1, Math.round(visibleRight - visibleLeft));
    const visibleHeight = Math.max(1, Math.round(visibleBottom - visibleTop));
    // dom-to-svg reads getBoundingClientRect(), whose coordinates already
    // include the iframe's current scroll position. Add only viewport clipping,
    // not scrollX/scrollY a second time.
    const frameX = Math.max(0, visibleLeft - rect.left);
    const frameY = Math.max(0, visibleTop - rect.top);
    await settleWithin(capture.document.fonts?.ready, 2_000);
    await settleWithin(waitForDocumentImages(capture.document), 2_000);

    const dataUrl = await renderDocumentAreaToDataUrl(
      capture.document,
      frameX,
      frameY,
      visibleWidth,
      visibleHeight
    );

    overlay = document.createElement("img");
    iframe.style.visibility = "hidden";
    iframeHidden = true;
    overlay.src = dataUrl;
    await waitForImageElementReady(overlay);

    return {
      image: overlay,
      left: visibleLeft,
      top: visibleTop,
      width: visibleWidth,
      height: visibleHeight,
      cleanup() {
        iframe.style.visibility = previousVisibility;
        capture.cleanup();
      }
    };
  } catch (error) {
    if (iframeHidden) {
      iframe.style.visibility = previousVisibility;
    }
    capture.cleanup();
    throw error;
  }
}

async function createVisibleIframeOverlays(): Promise<IframeOverlay[]> {
  const overlays: IframeOverlay[] = [];
  const iframes = Array.from(document.querySelectorAll("iframe"));
  for (const iframe of iframes) {
    try {
      const overlay = await createIframeOverlay(iframe);
      if (overlay) {
        overlays.push(overlay);
      }
    } catch (error) {
      console.warn("Could not include an iframe in the screenshot.", error);
    }
  }
  return overlays;
}

export async function captureCurrentPageScreenshotBlob(): Promise<Blob> {
  await settleWithin(document.fonts?.ready, 2_000);
  const overlays = await createVisibleIframeOverlays();
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const width = Math.max(1, Math.round(window.innerWidth));
    const height = Math.max(1, Math.round(window.innerHeight));
    const svg = await renderDocumentAreaToSvg(
      document,
      0,
      0,
      width,
      height
    );
    const scale = getScreenshotScale(width, height);
    return await rasterizeSvgToPngBlob(svg, width, height, scale, overlays);
  } finally {
    overlays.forEach((overlay) => overlay.cleanup());
  }
}
