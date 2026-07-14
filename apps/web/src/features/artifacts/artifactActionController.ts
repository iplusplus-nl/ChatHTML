import type { SessionState } from "../../domain/chat/sessionModel";
import type { StreamUiAction } from "../../runtime/streamui/types";
import { findSessionIdForMessage } from "../sessions/sessionSelectors";
import { buildArtifactActionMessage } from "./artifactMessageProjection";

export type ArtifactActionOutcome = "ignored" | "queued" | "sent";
export type ArtifactActionFlushOutcome =
  | "blocked"
  | "empty"
  | "ignored"
  | "sent";

export type ArtifactActionController = {
  handleAction(
    messageId: string,
    action: StreamUiAction
  ): ArtifactActionOutcome;
  flushPendingAction(): ArtifactActionFlushOutcome;
};

export type ArtifactActionControllerPorts = {
  isSending(): boolean;
  getSessionState(): SessionState;
  sendActionMessage(text: string, targetSessionId: string): void;
};

type PendingArtifactAction = {
  messageId: string;
  text: string;
  targetSessionId: string;
};

export function createArtifactActionController(
  ports: ArtifactActionControllerPorts
): ArtifactActionController {
  const pendingActions: PendingArtifactAction[] = [];

  const runAction = (pending: PendingArtifactAction): "ignored" | "sent" => {
    const targetSession = ports
      .getSessionState()
      .sessions.find((session) => session.id === pending.targetSessionId);
    if (
      !targetSession?.messages.some(
        (message) => message.id === pending.messageId
      )
    ) {
      return "ignored";
    }

    ports.sendActionMessage(pending.text, pending.targetSessionId);
    return "sent";
  };

  return {
    handleAction(messageId, action) {
      const text = buildArtifactActionMessage(action);
      const targetSessionId = findSessionIdForMessage(
        ports.getSessionState(),
        messageId
      );
      if (!text || !targetSessionId) {
        return "ignored";
      }

      const pending = { messageId, text, targetSessionId };
      if (ports.isSending()) {
        pendingActions.push(pending);
        return "queued";
      }

      return runAction(pending);
    },

    flushPendingAction() {
      if (ports.isSending()) {
        return "blocked";
      }
      if (!pendingActions.length) {
        return "empty";
      }

      // A queued action can become stale while another generation is running.
      // Skip stale entries without stranding the valid actions behind them.
      while (pendingActions.length) {
        const outcome = runAction(pendingActions.shift()!);
        if (outcome === "sent") {
          return outcome;
        }
      }

      return "ignored";
    }
  };
}
