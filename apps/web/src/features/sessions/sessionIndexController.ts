import type { SessionState } from "../../domain/chat/sessionModel";
import { requestSessionIndex } from "./sessionApi";
import {
  normalizeSessionListPreview,
  saveCachedSessionListPreview,
  sessionListPreviewFromState,
  type SessionListPreview
} from "./sessionPersistence";

export type SessionIndexOutcome = "applied" | "cancelled" | "skipped";

export type SessionIndexDependencies = {
  requestIndex(clientId: string): Promise<Response>;
  normalizePreview(payload: unknown): SessionListPreview | null;
  previewFromState(state: SessionState): SessionListPreview | null;
  saveCachedPreview(preview: SessionListPreview | null): void;
};

export type SessionIndexController = {
  load(clientId: string, isCancelled: () => boolean): Promise<SessionIndexOutcome>;
  syncFromState(state: SessionState, hydrated: boolean): SessionIndexOutcome;
  getLastPayload(): string | null;
};

const defaultDependencies: SessionIndexDependencies = {
  requestIndex: requestSessionIndex,
  normalizePreview: normalizeSessionListPreview,
  previewFromState: sessionListPreviewFromState,
  saveCachedPreview: saveCachedSessionListPreview
};

function previewPayload(preview: SessionListPreview | null): string | null {
  return preview ? JSON.stringify(preview) : null;
}

export function createSessionIndexController(
  input: {
    initialPreview: SessionListPreview | null;
    isSessionsHydrated(): boolean;
    setPreview(preview: SessionListPreview | null): void;
  },
  dependencyOverrides?: Partial<SessionIndexDependencies>
): SessionIndexController {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  let lastPayload = previewPayload(input.initialPreview);

  const apply = (
    preview: SessionListPreview | null,
    force: boolean
  ): SessionIndexOutcome => {
    const payload = previewPayload(preview);
    if (!force && payload === lastPayload) {
      return "skipped";
    }

    lastPayload = payload;
    input.setPreview(preview);
    dependencies.saveCachedPreview(preview);
    return "applied";
  };

  const load = async (
    clientId: string,
    isCancelled: () => boolean
  ): Promise<SessionIndexOutcome> => {
    const response = await dependencies.requestIndex(clientId);
    if (!response.ok) {
      throw new Error(`Session index load failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (isCancelled()) {
      return "cancelled";
    }

    // A full session response is authoritative once hydration has completed.
    // Ignoring a slower index response prevents it from restoring a stale cache.
    if (input.isSessionsHydrated()) {
      return "skipped";
    }

    return apply(dependencies.normalizePreview(payload), true);
  };

  const syncFromState = (
    state: SessionState,
    hydrated: boolean
  ): SessionIndexOutcome => {
    if (!hydrated) {
      return "skipped";
    }

    return apply(dependencies.previewFromState(state), false);
  };

  return {
    load,
    syncFromState,
    getLastPayload: () => lastPayload
  };
}
