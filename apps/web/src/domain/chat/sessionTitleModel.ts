import { extractStreamUiParts } from "../../runtime/streamui/protocol";
import { UNTITLED_SESSION } from "./sessionLifecycle";
import type { ClientMessage } from "./sessionTypes";

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripLegacyArtifactActionPrefix(value: string): string {
  return value.replace(/^I clicked\s+"[^"\n]{1,200}"\.\s*/u, "").trim();
}

export function titleFromText(value: string): string {
  const compact = compactText(value);
  if (!compact) {
    return UNTITLED_SESSION;
  }

  const withoutProtocol = compact
    .replace(/\b(sessiontitle|chat|streamui)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence =
    withoutProtocol.split(/(?<=[.!?。！？])\s+/u)[0] ?? withoutProtocol;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  const shortTitle =
    words.length > 7 ? words.slice(0, 7).join(" ") : firstSentence;

  if (shortTitle.length <= 58) {
    return shortTitle;
  }

  return `${shortTitle.slice(0, 57).trimEnd()}…`;
}

export function assistantMessageToSessionTitle(message: ClientMessage): string {
  if (message.role !== "assistant") {
    return "";
  }

  if (message.sessionTitle?.trim()) {
    return message.sessionTitle;
  }

  if (message.rawStream) {
    const parts = extractStreamUiParts(message.rawStream);
    if (parts.sessionTitleComplete && parts.sessionTitle.trim()) {
      return parts.sessionTitle;
    }
  }

  return "";
}

export function summarizeSession(messages: ClientMessage[]): string {
  const explicitTitle = messages
    .map(assistantMessageToSessionTitle)
    .find((text) => text.trim());
  if (explicitTitle) {
    return titleFromText(explicitTitle);
  }

  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return UNTITLED_SESSION;
  }

  if (firstUserMessage.content.trim()) {
    return titleFromText(firstUserMessage.content);
  }

  if (firstUserMessage.fileIds?.length || firstUserMessage.attachments?.length) {
    return "File conversation";
  }

  return UNTITLED_SESSION;
}

export function countUserPrompts(messages: ClientMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}
