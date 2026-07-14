import {
  buildIframeBodyHtml,
  getIframeThemeTokens,
  type IframeThemeTokens
} from "../../runtime/streamui/sandboxDocument";
import type { PageThemeMode } from "../../runtime/streamui/types";

export const PREVIEW_IFRAME_SANDBOX = "allow-scripts allow-popups";

export type PreviewHostRenderMessage = {
  source: "streamui-host";
  documentEpoch: string;
  kind: "render";
  actionsEnabled: false;
  bodyHtml: string;
  theme: IframeThemeTokens;
};

export type PreviewHostThemeMessage = {
  source: "streamui-host";
  documentEpoch: string;
  kind: "theme";
  theme: IframeThemeTokens;
};

export function createPreviewHostRenderMessage(
  completedHtml: string,
  themeMode: PageThemeMode,
  documentEpoch: string
): PreviewHostRenderMessage {
  return {
    source: "streamui-host",
    documentEpoch,
    kind: "render",
    actionsEnabled: false,
    bodyHtml: buildIframeBodyHtml(completedHtml),
    theme: getIframeThemeTokens(themeMode)
  };
}

export function createPreviewHostThemeMessage(
  themeMode: PageThemeMode,
  documentEpoch: string
): PreviewHostThemeMessage {
  return {
    source: "streamui-host",
    documentEpoch,
    kind: "theme",
    theme: getIframeThemeTokens(themeMode)
  };
}

type PreviewTokenCrypto = Pick<Crypto, "getRandomValues"> &
  Partial<Pick<Crypto, "randomUUID">>;

export function createPreviewChannelToken(
  cryptoSource: PreviewTokenCrypto = crypto
): string {
  try {
    const token = cryptoSource.randomUUID?.();
    if (token) {
      return token;
    }
  } catch {
    // randomUUID is unavailable in some non-secure self-hosted contexts.
  }

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join("")
  ].join("-");
}
