import { useEffect, useRef, useState } from "react";
import type { SessionState } from "../../domain/chat/sessionModel";
import {
  createSessionIndexController,
  type SessionIndexController,
  type SessionIndexDependencies
} from "./sessionIndexController";
import {
  loadCachedSessionListPreview,
  type SessionListPreview
} from "./sessionPersistence";

type ValueRef<T> = { current: T };

export type UseSessionIndexInput = {
  sessionState: SessionState;
  sessionsHydrated: boolean;
  sessionClientIdRef: ValueRef<string>;
  sessionsHydratedRef: ValueRef<boolean>;
  dependencies?: Partial<SessionIndexDependencies>;
};

export function useSessionIndex({
  sessionState,
  sessionsHydrated,
  sessionClientIdRef,
  sessionsHydratedRef,
  dependencies
}: UseSessionIndexInput): SessionListPreview | null {
  const [preview, setPreview] = useState<SessionListPreview | null>(
    loadCachedSessionListPreview
  );
  const controllerRef = useRef<SessionIndexController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createSessionIndexController(
      {
        initialPreview: preview,
        isSessionsHydrated: () => sessionsHydratedRef.current,
        setPreview
      },
      dependencies
    );
  }
  const controller = controllerRef.current;

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let cancelled = false;
    void controller
      .load(sessionClientIdRef.current, () => cancelled)
      .catch((error) => {
        if (!cancelled) {
          console.warn("Could not load ChatHTML session index.", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [controller, sessionClientIdRef]);

  useEffect(() => {
    controller.syncFromState(sessionState, sessionsHydrated);
  }, [controller, sessionState, sessionsHydrated]);

  return preview;
}
