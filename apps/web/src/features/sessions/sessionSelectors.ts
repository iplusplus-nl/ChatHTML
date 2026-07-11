import type {
  ClientMessage,
  SessionFile,
  SessionState
} from "../../domain/chat/sessionModel";

export function mergeSessionFiles(files: SessionFile[]): SessionFile[] {
  const merged = new Map<string, SessionFile>();
  for (const file of files) {
    merged.set(file.id, file);
  }

  return Array.from(merged.values()).sort((a, b) => a.createdAt - b.createdAt);
}

export function findSessionMessage(
  state: SessionState,
  messageId: string
): ClientMessage | undefined {
  for (const session of state.sessions) {
    const message = session.messages.find((candidate) => candidate.id === messageId);
    if (message) {
      return message;
    }
  }

  return undefined;
}

export function findSessionIdForMessage(
  state: SessionState,
  messageId: string
): string | undefined {
  for (const session of state.sessions) {
    if (session.messages.some((candidate) => candidate.id === messageId)) {
      return session.id;
    }
  }

  return undefined;
}
