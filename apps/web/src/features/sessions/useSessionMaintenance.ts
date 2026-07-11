import { useEffect, type RefObject } from "react";
import {
  interruptStaleArtifactEditsInSessionState,
  STALE_ARTIFACT_EDIT_SWEEP_INTERVAL_MS,
  type ChatSession,
  type SessionState
} from "../../domain/chat/sessionModel";
import type { PageThemeMode } from "../../runtime/streamui/types";
import { finalizePersistedGeneratedArtifactBatches } from "../artifacts/generatedArtifactBatchModel";
import type { ReplaceSessionState } from "./useSessionMessageMutations";

type ValueRef<T> = { current: T };

export function useStaleArtifactEditSweep(
  sessionsLoaded: boolean,
  replaceState: ReplaceSessionState
) {
  useEffect(() => {
    if (typeof window === "undefined" || !sessionsLoaded) {
      return undefined;
    }

    const sweep = () => {
      replaceState((current) =>
        interruptStaleArtifactEditsInSessionState(current)
      );
    };

    sweep();
    const intervalId = window.setInterval(
      sweep,
      STALE_ARTIFACT_EDIT_SWEEP_INTERVAL_MS
    );
    return () => window.clearInterval(intervalId);
  }, [replaceState, sessionsLoaded]);
}

export type GeneratedArtifactBatchRecoveryInput = {
  sessions: ChatSession[];
  sessionsLoaded: boolean;
  sessionStateRef: ValueRef<SessionState>;
  cancelledRunIdsRef: RefObject<Set<string>>;
  themeMode: PageThemeMode;
  replaceState: ReplaceSessionState;
  saveNow(): Promise<unknown>;
};

export function useGeneratedArtifactBatchRecovery({
  sessions,
  sessionsLoaded,
  sessionStateRef,
  cancelledRunIdsRef,
  themeMode,
  replaceState,
  saveNow
}: GeneratedArtifactBatchRecoveryInput) {
  useEffect(() => {
    if (!sessionsLoaded) {
      return;
    }

    const current = sessionStateRef.current;
    const finalized = finalizePersistedGeneratedArtifactBatches(
      current,
      themeMode,
      Date.now(),
      cancelledRunIdsRef.current ?? new Set<string>()
    );
    if (finalized === current) {
      return;
    }

    replaceState(finalized);
    void saveNow().catch((error) => {
      console.warn("Could not finalize restored artifact generation.", error);
    });
  }, [
    cancelledRunIdsRef,
    replaceState,
    saveNow,
    sessions,
    sessionsLoaded,
    sessionStateRef,
    themeMode
  ]);
}
