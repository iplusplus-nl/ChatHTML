import { useEffect, useState } from "react";
import type {
  ChatSession,
  ClientMessage,
  SessionState
} from "../../domain/chat/sessionModel";
import type {
  PageThemeMode,
  StreamingRenderer
} from "../../runtime/streamui/types";
import {
  reduceGeneratedArtifactBatchPatch,
  restoreGeneratedArtifactBatchOperation
} from "../artifacts/generatedArtifactBatchModel";
import type { ChatRunCancellationTarget } from "./chatRunCancellationController";
import type { ChatRunExecutionController } from "./chatRunExecutionController";
import type { ChatRunReconnectScheduler } from "./chatRunReconnectScheduler";
import type { ChatRunRuntimeRegistry } from "./chatRunRuntimeRegistry";
import { loadChatRunServerMessage } from "./chatRunServerMessage";
import type { ChatRunAssistantPhase } from "./chatRunRequest";
import type { SequencedMemoryStreamEvent } from "./chatStreamEvents";
import type { GenerationActivityCoordinator } from "./generationActivityCoordinator";
import { runRestoredChatRun } from "./restoredChatRunController";

type ValueRef<T> = { current: T };

export type UseRestoredChatRunsInput = {
  sessionsLoaded: boolean;
  sessions: ChatSession[];
  sessionStateRef: ValueRef<SessionState>;
  sessionClientIdRef: ValueRef<string>;
  runConnectionsRef: ValueRef<Map<string, AbortController>>;
  renderersRef: ValueRef<Map<string, StreamingRenderer>>;
  themeMode: PageThemeMode;
  generationActivity: GenerationActivityCoordinator;
  chatRunRuntimeRegistry: ChatRunRuntimeRegistry<ChatRunExecutionController>;
  restoredRunReconnectScheduler: ChatRunReconnectScheduler;
  handleMemoryStreamEvent(event: SequencedMemoryStreamEvent): void;
  updateAssistantMessageInSession(
    sessionId: string,
    assistantId: string,
    updater: (message: ClientMessage) => ClientMessage
  ): boolean;
  saveCurrentSessionStateNow(): unknown | Promise<unknown>;
};

export function useRestoredChatRuns({
  sessionsLoaded,
  sessions,
  sessionStateRef,
  sessionClientIdRef,
  runConnectionsRef,
  renderersRef,
  themeMode,
  generationActivity,
  chatRunRuntimeRegistry,
  restoredRunReconnectScheduler,
  handleMemoryStreamEvent,
  updateAssistantMessageInSession,
  saveCurrentSessionStateNow
}: UseRestoredChatRunsInput): void {
  const [restoredRunRetryVersion, setRestoredRunRetryVersion] = useState(0);

  useEffect(() => {
    if (!sessionsLoaded) {
      return;
    }

    for (const session of sessions) {
      for (const message of session.messages) {
        const generationRunId = message.generationRunId;
        if (
          message.role !== "assistant" ||
          message.status !== "streaming" ||
          !generationRunId ||
          runConnectionsRef.current.has(generationRunId) ||
          restoredRunReconnectScheduler.has(generationRunId)
        ) {
          continue;
        }

        const chatActivityLease =
          generationActivity.registerRestoredChatRun(generationRunId);
        if (!chatActivityLease) {
          continue;
        }
        const runTarget: ChatRunCancellationTarget = {
          runId: generationRunId,
          sessionId: session.id,
          assistantId: message.id
        };
        const runtimeRegistration =
          chatRunRuntimeRegistry.registerRestored(runTarget);
        const generatedBatchOperation =
          restoreGeneratedArtifactBatchOperation(session.id, message);
        const updateRestoredAssistant = (
          patch: Partial<ClientMessage>,
          phase: ChatRunAssistantPhase = "streaming"
        ) => {
          const changed = updateAssistantMessageInSession(
            session.id,
            message.id,
            (current) =>
              generatedBatchOperation
                ? reduceGeneratedArtifactBatchPatch(
                    current,
                    generatedBatchOperation,
                    patch,
                    phase,
                    themeMode
                  )
                : { ...current, ...patch }
          );
          if (changed && phase !== "streaming") {
            restoredRunReconnectScheduler.cancel(generationRunId);
            void Promise.resolve(saveCurrentSessionStateNow()).catch((error) => {
              console.warn(
                "Could not save restored generated artifact state.",
                error
              );
            });
          }
          return changed;
        };

        void runRestoredChatRun({
          target: {
            runId: generationRunId,
            sessionId: session.id,
            assistant: message,
            themeMode
          },
          activityLease: chatActivityLease,
          runtimeRegistration,
          connections: runConnectionsRef.current,
          renderers: renderersRef.current,
          reconnectScheduler: restoredRunReconnectScheduler,
          getClientId: () => sessionClientIdRef.current,
          updateAssistant: updateRestoredAssistant,
          onMemory: handleMemoryStreamEvent,
          loadServerMessage: () =>
            loadChatRunServerMessage({
              clientId: sessionClientIdRef.current,
              sessionId: session.id,
              assistantId: message.id
            }),
          isTargetStillStreaming: () => {
            const currentMessage = sessionStateRef.current.sessions
              .find((candidate) => candidate.id === session.id)
              ?.messages.find((candidate) => candidate.id === message.id);
            return Boolean(
              currentMessage?.role === "assistant" &&
                currentMessage.status === "streaming" &&
                currentMessage.generationRunId === generationRunId
            );
          },
          retry: () => setRestoredRunRetryVersion((current) => current + 1)
        });
      }
    }
  }, [
    chatRunRuntimeRegistry,
    generationActivity,
    handleMemoryStreamEvent,
    restoredRunReconnectScheduler,
    restoredRunRetryVersion,
    saveCurrentSessionStateNow,
    sessions,
    sessionsLoaded,
    themeMode,
    updateAssistantMessageInSession
  ]);
}
