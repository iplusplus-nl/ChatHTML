import { useCallback, useEffect } from "react";
import type { SessionState } from "../../domain/chat/sessionModel";
import {
  createSingleFlightSessionPoll,
  runInitialSessionLoad,
  runSessionPoll,
  type SessionStateUpdater,
  type SessionSyncDependencies
} from "./sessionSyncController";

type ValueRef<T> = { current: T };
type SizeLike = { readonly size: number };

export type UseSessionSyncInput = {
  sessionsLoaded: boolean;
  intervalMs: number;
  sessionClientIdRef: ValueRef<string>;
  sessionStateRef: ValueRef<SessionState>;
  sessionsLoadedRef: ValueRef<boolean>;
  sessionsHydratedRef: ValueRef<boolean>;
  deletedSessionIdsRef: ValueRef<ReadonlySet<string>>;
  transientEmptySessionIdRef: ValueRef<string | null>;
  runConnectionsRef: ValueRef<SizeLike>;
  cancelledRunIdsRef: ValueRef<SizeLike>;
  attachmentDraftsRef: ValueRef<boolean>;
  updateState: SessionStateUpdater;
  setSessionsLoaded(loaded: boolean): void;
  setSessionsHydrated(hydrated: boolean): void;
  dependencies?: Partial<SessionSyncDependencies>;
};

export function useSessionSync({
  sessionsLoaded,
  intervalMs,
  sessionClientIdRef,
  sessionStateRef,
  sessionsLoadedRef,
  sessionsHydratedRef,
  deletedSessionIdsRef,
  transientEmptySessionIdRef,
  runConnectionsRef,
  cancelledRunIdsRef,
  attachmentDraftsRef,
  updateState,
  setSessionsLoaded,
  setSessionsHydrated,
  dependencies
}: UseSessionSyncInput): void {
  const markSessionsHydrated = useCallback(() => {
    sessionsHydratedRef.current = true;
    setSessionsHydrated(true);
  }, [sessionsHydratedRef, setSessionsHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let cancelled = false;
    void runInitialSessionLoad(
      {
        clientId: sessionClientIdRef.current,
        isCancelled: () => cancelled,
        updateState,
        onApplied: markSessionsHydrated,
        getDeletedSessionIds: () => deletedSessionIdsRef.current,
        getTransientEmptySessionId: () => transientEmptySessionIdRef.current,
        hasActiveRuns: () => runConnectionsRef.current.size > 0,
        hasRecentCancellations: () =>
          cancelledRunIdsRef.current.size > 0,
        hasAttachmentDrafts: () => attachmentDraftsRef.current
      },
      dependencies
    )
      .catch((error) => {
        if (!cancelled) {
          console.warn("Could not load ChatHTML sessions.", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          sessionsLoadedRef.current = true;
          setSessionsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    deletedSessionIdsRef,
    attachmentDraftsRef,
    cancelledRunIdsRef,
    dependencies,
    sessionClientIdRef,
    markSessionsHydrated,
    runConnectionsRef,
    sessionsLoadedRef,
    setSessionsLoaded,
    transientEmptySessionIdRef,
    updateState
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !sessionsLoaded) {
      return undefined;
    }

    let cancelled = false;
    const poll = createSingleFlightSessionPoll(
      async () => {
        await runSessionPoll(
          {
            clientId: sessionClientIdRef.current,
            isCancelled: () => cancelled,
            getState: () => sessionStateRef.current,
            updateState,
            onApplied: markSessionsHydrated,
            getDeletedSessionIds: () => deletedSessionIdsRef.current,
            getTransientEmptySessionId: () =>
              transientEmptySessionIdRef.current,
            hasActiveRuns: () => runConnectionsRef.current.size > 0,
            hasRecentCancellations: () =>
              cancelledRunIdsRef.current.size > 0,
            hasAttachmentDrafts: () => attachmentDraftsRef.current
          },
          dependencies
        );
      },
      (error) => {
        if (!cancelled) {
          console.warn("Could not sync ChatHTML sessions.", error);
        }
      }
    );

    const intervalId = window.setInterval(() => poll.trigger(), intervalMs);
    poll.trigger();

    return () => {
      cancelled = true;
      poll.cancel();
      window.clearInterval(intervalId);
    };
  }, [
    cancelledRunIdsRef,
    attachmentDraftsRef,
    deletedSessionIdsRef,
    dependencies,
    intervalMs,
    markSessionsHydrated,
    runConnectionsRef,
    sessionClientIdRef,
    sessionStateRef,
    sessionsLoaded,
    transientEmptySessionIdRef,
    updateState
  ]);
}
