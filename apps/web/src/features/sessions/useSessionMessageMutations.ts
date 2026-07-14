import { useCallback } from "react";
import type {
  ClientMessage,
  SessionFile,
  SessionState
} from "../../domain/chat/sessionModel";
import type {
  ArtifactEditMutationOutcome,
  ArtifactEditTarget
} from "../artifacts/artifactEditController";
import { hasRenderError } from "../artifacts/renderErrors";
import type { RenderError } from "../../runtime/streamui/types";
import {
  updateMessageByIdInState,
  updateMessageInSessionByIdInState,
  upsertSessionFilesInState
} from "./sessionStateMutations";

type SessionStateUpdater =
  | SessionState
  | ((current: SessionState) => SessionState);

export type ReplaceSessionState = (updater: SessionStateUpdater) => void;

export type ArtifactEditMessageMutation = {
  state: SessionState;
  outcome: ArtifactEditMutationOutcome;
};

export function mutateArtifactEditMessageInState(
  state: SessionState,
  target: ArtifactEditTarget,
  updater: (message: ClientMessage) => ClientMessage
): ArtifactEditMessageMutation {
  let found = false;
  let changed = false;
  const nextState = updateMessageInSessionByIdInState(
    state,
    target.sessionId,
    target.assistantId,
    (message) => {
      found = true;
      const next = updater(message);
      changed = next !== message;
      return next;
    }
  );

  return {
    state: nextState,
    outcome: !found ? "missing" : changed ? "applied" : "unchanged"
  };
}

export function appendRuntimeErrorInState(
  state: SessionState,
  messageId: string,
  error: RenderError
): SessionState {
  let didUpdate = false;
  const sessions = state.sessions.map((session) => {
    let sessionChanged = false;
    const messages = session.messages.map((message) => {
      if (message.id !== messageId || !message.snapshot) {
        return message;
      }
      if (error.kind === "readability") {
        const previousRuntimeErrors = message.runtimeErrors ?? [];
        const previousSnapshotErrors = message.snapshot.errors;
        const runtimeErrorsWithoutReadability = previousRuntimeErrors.filter(
          (item) => item.kind !== "readability"
        );
        const snapshotErrorsWithoutReadability = previousSnapshotErrors.filter(
          (item) => item.kind !== "readability"
        );
        const nextReadabilityError = error.message.trim() ? error : undefined;
        const runtimeErrors = nextReadabilityError
          ? [...runtimeErrorsWithoutReadability, nextReadabilityError]
          : runtimeErrorsWithoutReadability;
        const snapshotErrors = nextReadabilityError
          ? [...snapshotErrorsWithoutReadability, nextReadabilityError]
          : snapshotErrorsWithoutReadability;
        const previousReadability = previousRuntimeErrors.find(
          (item) => item.kind === "readability"
        );
        const previousSnapshotReadability = previousSnapshotErrors.find(
          (item) => item.kind === "readability"
        );
        if (
          previousRuntimeErrors.length === runtimeErrors.length &&
          previousSnapshotErrors.length === snapshotErrors.length &&
          previousReadability?.message === nextReadabilityError?.message &&
          previousSnapshotReadability?.message === nextReadabilityError?.message
        ) {
          return message;
        }

        didUpdate = true;
        sessionChanged = true;
        return {
          ...message,
          runtimeErrors: runtimeErrors.length ? runtimeErrors : undefined,
          snapshot: {
            ...message.snapshot,
            errors: snapshotErrors
          }
        };
      }
      if (
        hasRenderError(message.runtimeErrors, error) ||
        hasRenderError(message.snapshot.errors, error)
      ) {
        return message;
      }

      didUpdate = true;
      sessionChanged = true;
      const runtimeErrors = [...(message.runtimeErrors ?? []), error];
      return {
        ...message,
        runtimeErrors,
        snapshot: {
          ...message.snapshot,
          errors: [...message.snapshot.errors, error]
        }
      };
    });

    return sessionChanged ? { ...session, messages } : session;
  });

  return didUpdate ? { ...state, sessions } : state;
}

export function useSessionMessageMutations(
  replaceState: ReplaceSessionState
) {
  const upsertSessionFiles = useCallback(
    (sessionId: string, files: SessionFile[]) => {
      replaceState((current) =>
        upsertSessionFilesInState(current, sessionId, files)
      );
    },
    [replaceState]
  );

  const updateAssistantMessage = useCallback(
    (id: string, updater: (message: ClientMessage) => ClientMessage) => {
      replaceState((current) =>
        updateMessageByIdInState(current, id, updater)
      );
    },
    [replaceState]
  );

  const updateAssistantMessageInSession = useCallback(
    (
      sessionId: string,
      id: string,
      updater: (message: ClientMessage) => ClientMessage
    ) => {
      let changed = false;
      replaceState((current) =>
        updateMessageInSessionByIdInState(
          current,
          sessionId,
          id,
          (message) => {
            const next = updater(message);
            changed = next !== message;
            return next;
          }
        )
      );
      return changed;
    },
    [replaceState]
  );

  const mutateArtifactEditMessage = useCallback(
    (
      target: ArtifactEditTarget,
      updater: (message: ClientMessage) => ClientMessage
    ): ArtifactEditMutationOutcome => {
      let outcome: ArtifactEditMutationOutcome = "missing";
      replaceState((current) => {
        const mutation = mutateArtifactEditMessageInState(
          current,
          target,
          updater
        );
        outcome = mutation.outcome;
        return mutation.state;
      });
      return outcome;
    },
    [replaceState]
  );

  const appendRuntimeError = useCallback(
    (messageId: string, error: RenderError) => {
      replaceState((current) =>
        appendRuntimeErrorInState(current, messageId, error)
      );
    },
    [replaceState]
  );

  return {
    upsertSessionFiles,
    updateAssistantMessage,
    updateAssistantMessageInSession,
    mutateArtifactEditMessage,
    appendRuntimeError
  };
}
