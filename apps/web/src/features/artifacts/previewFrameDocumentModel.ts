import { buildIframeDocument } from "../../runtime/streamui/sandboxDocument";
import type { PageThemeMode } from "../../runtime/streamui/types";

export type PreviewFrameDocumentMode = "streaming" | "complete";

export type PreviewFrameDocument = {
  epoch: number;
  mode: PreviewFrameDocumentMode;
  completedHtml: string;
  themeMode: PageThemeMode;
  channelToken: string;
  documentEpoch: string;
  source: string;
};

type CreatePreviewFrameDocumentInput = {
  epoch: number;
  mode: PreviewFrameDocumentMode;
  completedHtml: string;
  themeMode: PageThemeMode;
  channelToken: string;
  documentEpoch: string;
};

export function createPreviewFrameDocument({
  epoch,
  mode,
  completedHtml,
  themeMode,
  channelToken,
  documentEpoch
}: CreatePreviewFrameDocumentInput): PreviewFrameDocument {
  if (!channelToken || !documentEpoch || channelToken === documentEpoch) {
    throw new Error("Preview frame directions require distinct document tokens.");
  }

  const isComplete = mode === "complete";
  const initialHtml = isComplete ? completedHtml : "";

  return {
    epoch,
    mode,
    completedHtml: initialHtml,
    themeMode,
    channelToken,
    documentEpoch,
    source: buildIframeDocument(
      initialHtml,
      themeMode,
      isComplete,
      channelToken,
      documentEpoch
    )
  };
}

export function previewFrameDocumentMatches(
  document: PreviewFrameDocument,
  mode: PreviewFrameDocumentMode,
  completedHtml: string,
  _themeMode: PageThemeMode
): boolean {
  return (
    document.mode === mode &&
    (mode === "streaming" || document.completedHtml === completedHtml)
  );
}
