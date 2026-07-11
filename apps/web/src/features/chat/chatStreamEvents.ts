import type { MemoryStreamEvent } from "../../core/memoryStreamEvents";
import {
  isChatCancelledMessage,
  sanitizeChatErrorMessage
} from "./chatErrors";

type TextStreamEvent = {
  type?: "content" | "reasoning";
  text?: string;
  runId?: string;
  seq?: number;
};

type DoneStreamEvent = {
  type: "done";
  status?: ChatStreamTerminalStatus;
  error?: string;
  runId?: string;
  seq?: number;
};

export type SequencedMemoryStreamEvent = MemoryStreamEvent & {
  runId?: string;
  seq?: number;
};

type ChatStreamEvent =
  | TextStreamEvent
  | DoneStreamEvent
  | SequencedMemoryStreamEvent;

export type ChatStreamTerminalStatus =
  | "complete"
  | "error"
  | "cancelled";

export type ParsedChatStreamEvent =
  | {
      kind: "content";
      text: string;
      runId?: string;
      sequence?: number;
    }
  | {
      kind: "reasoning";
      text: string;
      runId?: string;
      sequence?: number;
    }
  | {
      kind: "memory";
      event: SequencedMemoryStreamEvent;
      runId?: string;
      sequence?: number;
    }
  | {
      kind: "done";
      status: ChatStreamTerminalStatus;
      error: string;
      runId?: string;
      sequence?: number;
    };

export type ChatStreamLineHandlers = {
  runId: string;
  getLastSequence(): number;
  onSequence(sequence: number): void;
  onContent(text: string, sequence?: number): void;
  onReasoning(text: string, sequence?: number): void;
  onMemory(event: SequencedMemoryStreamEvent, sequence?: number): void;
  onDone(
    status: ChatStreamTerminalStatus,
    error: string,
    sequence?: number
  ): void;
};

function normalizeSequence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

export function parseChatStreamLine(
  line: string
): ParsedChatStreamEvent | null {
  if (!line.trim()) {
    return null;
  }

  try {
    const event = JSON.parse(line) as ChatStreamEvent;
    const sequence = normalizeSequence(event.seq);
    const runId = typeof event.runId === "string" ? event.runId : undefined;

    if (event.type === "done") {
      const cancelled =
        event.status === "cancelled" || isChatCancelledMessage(event.error);
      return {
        kind: "done",
        status: cancelled
          ? "cancelled"
          : event.status === "error"
            ? "error"
            : "complete",
        error: sanitizeChatErrorMessage(event.error, ""),
        runId,
        sequence
      };
    }
    if (event.type === "memory") {
      return { kind: "memory", event, runId, sequence };
    }
    if (event.type === "reasoning" && event.text) {
      return { kind: "reasoning", text: event.text, runId, sequence };
    }
    if (event.type === "content" && event.text) {
      return { kind: "content", text: event.text, runId, sequence };
    }

    return null;
  } catch {
    return { kind: "content", text: line };
  }
}

export function createChatStreamLineHandler(
  handlers: ChatStreamLineHandlers
): (line: string) => void {
  return (line) => {
    const event = parseChatStreamLine(line);
    if (!event) {
      return;
    }

    if (event.runId && event.runId !== handlers.runId) {
      return;
    }

    const isStaleSequence =
      typeof event.sequence === "number" &&
      event.sequence <= handlers.getLastSequence();
    if (isStaleSequence && event.kind !== "memory") {
      return;
    }

    if (typeof event.sequence === "number" && !isStaleSequence) {
      handlers.onSequence(event.sequence);
    }

    switch (event.kind) {
      case "content":
        handlers.onContent(event.text, event.sequence);
        break;
      case "reasoning":
        handlers.onReasoning(event.text, event.sequence);
        break;
      case "memory":
        handlers.onMemory(event.event, event.sequence);
        break;
      case "done":
        handlers.onDone(event.status, event.error, event.sequence);
        break;
    }
  };
}
