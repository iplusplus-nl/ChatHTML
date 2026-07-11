import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialSessionState,
  type SessionState
} from "../../domain/chat/sessionModel";

export type SessionStateUpdater =
  | SessionState
  | ((current: SessionState) => SessionState);

export function useSessionStateController() {
  const [sessionState, setSessionState] =
    useState<SessionState>(createInitialSessionState);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsHydrated, setSessionsHydrated] = useState(false);
  const sessionStateRef = useRef(sessionState);
  const activeSessionIdRef = useRef(sessionState.activeSessionId);
  const sessionsLoadedRef = useRef(sessionsLoaded);
  const sessionsHydratedRef = useRef(sessionsHydrated);
  const deletedSessionIdsRef = useRef<Set<string>>(new Set());
  const transientEmptySessionIdRef = useRef<string | null>(null);

  const replaceState = useCallback((updater: SessionStateUpdater) => {
    const current = sessionStateRef.current;
    const next =
      typeof updater === "function"
        ? (updater as (current: SessionState) => SessionState)(current)
        : updater;

    sessionStateRef.current = next;
    setSessionState(next);
  }, []);

  useEffect(() => {
    sessionStateRef.current = sessionState;
    activeSessionIdRef.current = sessionState.activeSessionId;
  }, [sessionState]);

  useEffect(() => {
    sessionsLoadedRef.current = sessionsLoaded;
  }, [sessionsLoaded]);

  return {
    sessionState,
    sessionsLoaded,
    sessionsHydrated,
    sessionStateRef,
    activeSessionIdRef,
    sessionsLoadedRef,
    sessionsHydratedRef,
    deletedSessionIdsRef,
    transientEmptySessionIdRef,
    replaceState,
    setSessionsLoaded,
    setSessionsHydrated
  };
}
