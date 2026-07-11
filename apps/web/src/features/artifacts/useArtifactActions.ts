import { useEffect, useMemo, useRef } from "react";
import {
  createArtifactActionController,
  type ArtifactActionController
} from "./artifactActionController";
import type { SessionState } from "../../domain/chat/sessionModel";

type ValueRef<T> = { current: T };

export type UseArtifactActionsInput = {
  isSending: boolean;
  isSendingRef: ValueRef<boolean>;
  sessionStateRef: ValueRef<SessionState>;
  sendActionMessage(text: string, targetSessionId: string): void;
};

export function useArtifactActions({
  isSending,
  isSendingRef,
  sessionStateRef,
  sendActionMessage
}: UseArtifactActionsInput): ArtifactActionController["handleAction"] {
  const sendActionMessageRef = useRef(sendActionMessage);
  sendActionMessageRef.current = sendActionMessage;
  const controller = useMemo(
    () =>
      createArtifactActionController({
        isSending: () => isSendingRef.current,
        getSessionState: () => sessionStateRef.current,
        sendActionMessage: (text, targetSessionId) =>
          sendActionMessageRef.current(text, targetSessionId)
      }),
    [isSendingRef, sessionStateRef]
  );

  useEffect(() => {
    controller.flushPendingAction();
  }, [controller, isSending]);

  return controller.handleAction;
}
