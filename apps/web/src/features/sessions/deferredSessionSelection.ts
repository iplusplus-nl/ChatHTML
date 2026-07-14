import type { SessionActionsController } from "./sessionActionsController";

export type DeferredSessionSelectionOutcome =
  | ReturnType<SessionActionsController["selectSession"]>
  | "deferred"
  | "blocked"
  | "empty";

export type DeferredSessionSelectionController = {
  request(sessionId: string, hydrated: boolean): DeferredSessionSelectionOutcome;
  flush(hydrated: boolean): DeferredSessionSelectionOutcome;
  clear(): void;
  peek(): string | null;
};

export function createDeferredSessionSelectionController(input: {
  hasSession(sessionId: string): boolean;
  selectSession(sessionId: string): ReturnType<
    SessionActionsController["selectSession"]
  >;
}): DeferredSessionSelectionController {
  let pendingSessionId: string | null = null;

  return {
    request(sessionId, hydrated) {
      if (!sessionId) {
        return "not-found";
      }
      if (!hydrated && !input.hasSession(sessionId)) {
        pendingSessionId = sessionId;
        return "deferred";
      }

      pendingSessionId = null;
      return input.selectSession(sessionId);
    },

    flush(hydrated) {
      if (!pendingSessionId) {
        return "empty";
      }
      if (!hydrated) {
        return "blocked";
      }

      const sessionId = pendingSessionId;
      pendingSessionId = null;
      return input.selectSession(sessionId);
    },

    clear() {
      pendingSessionId = null;
    },

    peek: () => pendingSessionId
  };
}
