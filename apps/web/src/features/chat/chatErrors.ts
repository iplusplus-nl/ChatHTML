import type { ClientMessage } from "../../domain/chat/sessionModel";
import { extractStreamUiParts } from "../../runtime/streamui/protocol";

const CHAT_CANCELLED_MESSAGE = "Generation stopped.";

function compactErrorText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtmlErrorText(value: string): string {
  return compactErrorText(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
  );
}

function looksLikeHtmlError(value: string): boolean {
  return /<!doctype\s+html|<html\b|<head\b|<body\b|<\/?[a-z][\s\S]*>/i.test(
    value
  );
}

function extractHtmlErrorTitle(value: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(value);
  return match ? stripHtmlErrorText(match[1]) : "";
}

function safeErrorJsonMessage(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return "";
    }

    const error = parsed as { error?: unknown; message?: unknown };
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
    if (typeof error.error === "string" && error.error.trim()) {
      return error.error.trim();
    }
    if (error.error && typeof error.error === "object") {
      const nested = error.error as { message?: unknown };
      return typeof nested.message === "string" ? nested.message.trim() : "";
    }
  } catch {
    return "";
  }

  return "";
}

export function sanitizeChatErrorMessage(
  value: string | undefined,
  fallback = "The chat request failed."
): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return fallback;
  }

  const jsonMessage = safeErrorJsonMessage(raw);
  if (jsonMessage) {
    return compactErrorText(jsonMessage).slice(0, 500);
  }

  if (looksLikeHtmlError(raw)) {
    return (
      extractHtmlErrorTitle(raw) ||
      stripHtmlErrorText(raw) ||
      fallback
    ).slice(0, 180);
  }

  return compactErrorText(raw).slice(0, 500);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function isChatCancelledMessage(value: string | undefined): boolean {
  return compactErrorText(value ?? "") === CHAT_CANCELLED_MESSAGE;
}

export function createCancelledAssistantPatch(
  raw: string,
  reasoning: string,
  streamSequence: number
): Partial<ClientMessage> {
  const parts = extractStreamUiParts(raw);

  return {
    content:
      parts.chat ||
      (!parts.hasStreamUi ? parts.fallbackText : "") ||
      CHAT_CANCELLED_MESSAGE,
    reasoning: reasoning || undefined,
    rawStream: raw,
    streamSequence,
    hasStreamUi: parts.hasStreamUi,
    streamUiComplete: parts.streamUiComplete,
    generationOutcome: "cancelled",
    status: "complete",
    error: undefined
  };
}

export function formatChatHttpError(
  response: Response,
  bodyText: string
): string {
  const statusText = compactErrorText(response.statusText || "");
  const status = `HTTP ${response.status}${statusText ? ` ${statusText}` : ""}`;
  const detail = sanitizeChatErrorMessage(bodyText, "");
  const prefix = `Request failed with ${status}.`;

  if (!detail || detail.toLowerCase().includes(String(response.status))) {
    return prefix;
  }

  return `${prefix} ${detail}`;
}
