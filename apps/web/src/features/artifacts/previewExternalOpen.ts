export type PreviewWindowOpen = (
  url: string,
  target: string,
  features: string
) => { opener: unknown } | null;

export function openPreviewExternalUrl(
  url: string,
  openWindow: PreviewWindowOpen
): void {
  const opened = openWindow(url, "_blank", "noopener,noreferrer");
  if (opened) {
    opened.opener = null;
  }
}
