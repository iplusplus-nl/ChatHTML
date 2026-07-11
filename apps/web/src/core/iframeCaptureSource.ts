const captureSources = new WeakMap<HTMLIFrameElement, string>();

export function setIframeCaptureSource(
  iframe: HTMLIFrameElement,
  source: string
): void {
  captureSources.set(iframe, source);
}

export function clearIframeCaptureSource(iframe: HTMLIFrameElement): void {
  captureSources.delete(iframe);
}

export function getIframeCaptureSource(
  iframe: HTMLIFrameElement
): string | undefined {
  return captureSources.get(iframe);
}
