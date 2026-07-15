import { useEffect, useRef, useState } from "react";
import type { SessionState } from "../../domain/chat/sessionModel";
import {
  createSessionIndexController,
  type SessionIndexController,
  type SessionIndexDependencies
} from "./sessionIndexController";
import {
  loadCachedSessionListPreview,
  saveCachedSessionListPreview,
  type SessionListPreview
} from "./sessionPersistence";

type ValueRef<T> = { current: T };

export type UseSessionIndexInput = {
  enabled?: boolean;
  cacheEnabled?: boolean;
  sessionState: SessionState;
  sessionsHydrated: boolean;
  sessionClientIdRef: ValueRef<string>;
  sessionsHydratedRef: ValueRef<boolean>;
  dependencies?: Partial<SessionIndexDependencies>;
};

export function useSessionIndex({
  enabled = true,
  cacheEnabled = true,
  sessionState,
  sessionsHydrated,
  sessionClientIdRef,
  sessionsHydratedRef,
  dependencies
}: UseSessionIndexInput): SessionListPreview | null {
  const [preview, setPreview] = useState<SessionListPreview | null>(
    () => (cacheEnabled ? loadCachedSessionListPreview() : null)
  );
  const cacheEnabledRef = useRef(cacheEnabled);
  cacheEnabledRef.current = cacheEnabled;
  const controllerRef = useRef<SessionIndexController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createSessionIndexController(
      {
        initialPreview: preview,
        isSessionsHydrated: () => sessionsHydratedRef.current,
        setPreview
      },
      {
        ...dependencies,
        saveCachedPreview: (value) => {
          if (cacheEnabledRef.current) {
            (dependencies?.saveCachedPreview ?? saveCachedSessionListPreview)(value);
          }
        }
      }
    );
  }
  const controller = controllerRef.current;

  useEffect(() => {
    if (!cacheEnabled) {
      setPreview(null);
      return;
    }
    if (!sessionsHydrated) {
      setPreview(loadCachedSessionListPreview());
    }
  }, [cacheEnabled, sessionsHydrated]);

  useEffect(() => {
    if (typeof window === "undefined" || !enabled) {
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
  }, [controller, enabled, sessionClientIdRef]);

  useEffect(() => {
    if (enabled) {
      controller.syncFromState(sessionState, sessionsHydrated);
    }
  }, [controller, enabled, sessionState, sessionsHydrated]);

  return enabled ? preview : null;
}
