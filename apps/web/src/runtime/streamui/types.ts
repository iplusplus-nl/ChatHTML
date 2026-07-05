export type RenderStatus = "idle" | "streaming" | "complete" | "error";

export type PageThemeMode = "day" | "night";

export type RenderErrorKind = "html" | "runtime" | "security" | "console";

export type RenderError = {
  kind: RenderErrorKind;
  message: string;
  timestamp: number;
};

export type StreamUiPromptAction = {
  type: "prompt";
  prompt: string;
  label?: string;
};

export type StreamUiCopyAction = {
  type: "copy";
  text: string;
  label?: string;
};

export type StreamUiDownloadAction = {
  type: "download";
  text: string;
  filename?: string;
  mimeType?: string;
  label?: string;
};

export type StreamUiOpenUrlAction = {
  type: "open-url";
  url: string;
  label?: string;
};

export type StreamUiAction =
  | StreamUiPromptAction
  | StreamUiCopyAction
  | StreamUiDownloadAction
  | StreamUiOpenUrlAction;

export type RenderSnapshot = {
  raw: string;
  completedHtml: string;
  iframeDocument: string;
  errors: RenderError[];
  status: RenderStatus;
};

export type StreamingRenderer = {
  feed(chunk: string): void;
  replace(raw: string): void;
  complete(): void;
  getSnapshot(): RenderSnapshot;
  reset(): void;
  onSnapshot(callback: (snapshot: RenderSnapshot) => void): () => void;
  onError(callback: (error: RenderError) => void): () => void;
};

export type ExtractedStreamUiParts = {
  sessionTitle: string;
  chat: string;
  streamui: string;
  hasSessionTitle: boolean;
  sessionTitleComplete: boolean;
  hasChat: boolean;
  hasStreamUi: boolean;
  streamUiComplete: boolean;
  fallbackText: string;
};
