import { useCallback, useMemo } from "react";
import {
  getSessionStreamingRunIds,
  summarizeSession,
  type ChatSession,
  type SessionState
} from "../../domain/chat/sessionModel";
import {
  getAssistantBranchInfo,
  getVisibleSessionMessages
} from "../chat/branching";

export type SessionListViewItem = {
  id: string;
  title: string;
};

export function getActiveSession(
  state: SessionState
): ChatSession | undefined {
  return (
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    state.sessions[0]
  );
}

export function deriveSessionListItems(
  sessions: ChatSession[]
): SessionListViewItem[] {
  return sessions.map((session) => ({
    id: session.id,
    title: session.title || summarizeSession(session.messages)
  }));
}

export function useSessionViewModel(sessionState: SessionState) {
  const activeSession = getActiveSession(sessionState);
  const messages = useMemo(
    () => getVisibleSessionMessages(activeSession),
    [activeSession]
  );
  const sessionItems = useMemo(
    () => deriveSessionListItems(sessionState.sessions),
    [sessionState.sessions]
  );
  const getBranchInfo = useCallback(
    (messageId: string) => getAssistantBranchInfo(activeSession, messageId),
    [activeSession]
  );

  return {
    activeSession,
    messages,
    sessionItems,
    getBranchInfo,
    activeFiles: activeSession?.files ?? [],
    isActiveSessionSending:
      getSessionStreamingRunIds(activeSession).length > 0
  };
}
