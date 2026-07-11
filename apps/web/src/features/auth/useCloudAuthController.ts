import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AuthSummary,
  AuthUser
} from "../../core/cloudAuth";
import {
  runCloudAuthLogout,
  runCloudAuthRefresh,
  runInitialCloudAuthLoad,
  type CloudAuthDependencies
} from "./cloudAuthController";
import { authSummaryWithUser } from "./cloudAuthModel";

export type UseCloudAuthControllerInput = {
  cloudEnabled: boolean;
  dependencies?: Partial<CloudAuthDependencies>;
};

export type CloudAuthController = {
  summary: AuthSummary | null;
  loaded: boolean;
  user: AuthUser | null;
  isOverlayOpen: boolean;
  open(): void;
  close(): void;
  acceptSummary(summary: AuthSummary): void;
  updateUser(user: AuthUser): void;
  refresh(): Promise<AuthSummary | null>;
  logout(): Promise<void>;
};

export function useCloudAuthController({
  cloudEnabled,
  dependencies
}: UseCloudAuthControllerInput): CloudAuthController {
  // Dependency overrides are test seams and intentionally mount-scoped.
  const dependenciesRef = useRef(dependencies);
  const stableDependencies = dependenciesRef.current;
  const [summary, setSummary] = useState<AuthSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  useEffect(() => {
    if (!cloudEnabled) {
      setSummary(null);
      setLoaded(false);
      setIsOverlayOpen(false);
      return undefined;
    }

    let cancelled = false;
    void runInitialCloudAuthLoad(
      {
        isCancelled: () => cancelled,
        setSummary,
        setLoaded
      },
      stableDependencies
    );

    return () => {
      cancelled = true;
    };
  }, [cloudEnabled, stableDependencies]);

  const open = useCallback(() => setIsOverlayOpen(true), []);
  const close = useCallback(() => setIsOverlayOpen(false), []);
  const acceptSummary = useCallback((nextSummary: AuthSummary) => {
    setSummary(nextSummary);
    setLoaded(true);
    setIsOverlayOpen(false);
  }, []);
  const updateUser = useCallback((user: AuthUser) => {
    setSummary((current) => authSummaryWithUser(current, user));
    setLoaded(true);
  }, []);
  const refresh = useCallback(
    () =>
      runCloudAuthRefresh(
        {
          cloudEnabled,
          setSummary,
          setLoaded
        },
        stableDependencies
      ),
    [cloudEnabled, stableDependencies]
  );
  const logout = useCallback(async () => {
    await runCloudAuthLogout(
      {
        setSummary,
        setLoaded,
        setOverlayOpen: setIsOverlayOpen
      },
      stableDependencies
    );
  }, [stableDependencies]);

  return useMemo(
    () => ({
      summary,
      loaded,
      user: cloudEnabled ? (summary?.user ?? null) : null,
      isOverlayOpen,
      open,
      close,
      acceptSummary,
      updateUser,
      refresh,
      logout
    }),
    [
      acceptSummary,
      close,
      cloudEnabled,
      isOverlayOpen,
      loaded,
      logout,
      open,
      refresh,
      summary,
      updateUser
    ]
  );
}
