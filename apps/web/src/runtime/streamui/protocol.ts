import type { ExtractedStreamUiParts } from "./types";

function extractBetween(
  raw: string,
  tagName: "sessiontitle" | "chat" | "streamui"
): { content: string; hasOpen: boolean; hasClose: boolean } {
  const openPattern = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const openMatch = openPattern.exec(raw);

  if (!openMatch || openMatch.index === undefined) {
    return { content: "", hasOpen: false, hasClose: false };
  }

  const contentStart = openMatch.index + openMatch[0].length;
  const closePattern = new RegExp(`</${tagName}>`, "i");
  const closeMatch = closePattern.exec(raw.slice(contentStart));

  if (!closeMatch) {
    return {
      content: raw.slice(contentStart),
      hasOpen: true,
      hasClose: false
    };
  }

  return {
    content: raw.slice(contentStart, contentStart + closeMatch.index),
    hasOpen: true,
    hasClose: true
  };
}

function extractStreamUi(raw: string): {
  content: string;
  hasOpen: boolean;
  hasClose: boolean;
} {
  const lower = raw.toLowerCase();
  const closeTag = "</streamui>";
  const openPattern = /<streamui\b[^>]*>/i;
  const openMatch = openPattern.exec(raw);

  if (!openMatch || openMatch.index === undefined) {
    return { content: "", hasOpen: false, hasClose: false };
  }

  const contentStart = openMatch.index + openMatch[0].length;
  const contentTail = raw.slice(contentStart);
  const lowerTail = lower.slice(contentStart);

  return {
    content: contentTail
      .replace(/<\/?streamui>/gi, "")
      .replace(/<streamui\b[^>]*>/gi, "")
      .replace(/<sessiontitle>[\s\S]*?<\/sessiontitle>/gi, "")
      .replace(/<sessiontitle\b[^>]*>[\s\S]*?<\/sessiontitle>/gi, "")
      .replace(/<sessiontitle\b[^>]*>[\s\S]*$/gi, "")
      .replace(/<\/?chat[^>]*>/gi, ""),
    hasOpen: true,
    hasClose: lowerTail.includes(closeTag)
  };
}

function removeProtocolTags(raw: string): string {
  return raw
    .replace(/<sessiontitle>[\s\S]*?<\/sessiontitle>/gi, "")
    .replace(/<sessiontitle\b[^>]*>[\s\S]*?<\/sessiontitle>/gi, "")
    .replace(/<sessiontitle\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/?chat[^>]*>/gi, "")
    .replace(/<streamui\b[^>]*>[\s\S]*?<\/streamui>/gi, "")
    .replace(/<streamui\b[^>]*>[\s\S]*$/gi, "")
    .trim();
}

export function extractStreamUiParts(raw: string): ExtractedStreamUiParts {
  const sessionTitle = extractBetween(raw, "sessiontitle");
  const chat = extractBetween(raw, "chat");
  const streamui = extractStreamUi(raw);
  const fallbackText = chat.hasOpen
    ? chat.content.trim()
    : removeProtocolTags(raw);

  return {
    sessionTitle: sessionTitle.content.trim(),
    chat: chat.content.trim(),
    streamui: streamui.content,
    hasSessionTitle: sessionTitle.hasOpen,
    sessionTitleComplete: sessionTitle.hasClose,
    hasChat: chat.hasOpen,
    hasStreamUi: streamui.hasOpen,
    streamUiComplete: streamui.hasClose,
    fallbackText
  };
}
