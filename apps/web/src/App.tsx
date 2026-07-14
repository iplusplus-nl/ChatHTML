import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage
} from "@assistant-ui/react";
import { ChatShell } from "./components/ChatShell";
import { AuthChoiceDialog } from "./components/AuthChoiceDialog";
import { BugReportDialog } from "./components/BugReportDialog";
import { SessionSidebar } from "./components/SessionSidebar";
import {
  loadAccountMode,
  saveAccountMode,
  type AccountMode
} from "./core/accountMode";
import { createId } from "./domain/chat/sessionModel";
import { useChatRunCancellation } from "./features/chat/useChatRunCancellation";
import { createChatRunReconnectScheduler } from "./features/chat/chatRunReconnectScheduler";
import type { ChatRunExecutionController } from "./features/chat/chatRunExecutionController";
import { createChatRunRuntimeRegistry } from "./features/chat/chatRunRuntimeRegistry";
import type { PendingManagedRequest } from "./features/chat/chatRunRequest";
import { createBranchTurnPlan } from "./features/chat/branchTurnPlanner";
import {
  createMessageRevisionController,
  type MessageRevisionBranchInput
} from "./features/chat/messageRevisionController";
import { createGenerationActivityCoordinator } from "./features/chat/generationActivityCoordinator";
import {
  convertMessage,
  getAppendMessageImages,
  getAppendMessageText
} from "./features/chat/assistantRuntimeAdapter";
import { createPendingRequestSlot } from "./features/chat/pendingRequestSlot";
import {
  openManualAuth,
  replayManagedAuthRequest
} from "./features/chat/managedAuthContinuation";
import { StreamThread } from "./features/chat/ui/StreamThread";
import { useBugReportController } from "./features/bug-reports/useBugReportController";
import {
  getAssistantForUserTurn,
  getVisibleSessionMessages
} from "./features/chat/branching";
import { submitComposerMessage } from "./features/chat/composerSubmissionController";
import {
  loadSessionClientId
} from "./features/sessions/sessionPersistence";
import { useSessionSync } from "./features/sessions/useSessionSync";
import { useSessionSave } from "./features/sessions/useSessionSave";
import { useSessionIndex } from "./features/sessions/useSessionIndex";
import { useSessionActions } from "./features/sessions/useSessionActions";
import { createDeferredSessionSelectionController } from "./features/sessions/deferredSessionSelection";
import { discardComposerAttachmentsAndRun } from "./features/sessions/composerAttachmentNavigation";
import { useSessionAttachmentController } from "./features/sessions/useSessionAttachmentController";
import { useSessionStateController } from "./features/sessions/useSessionStateController";
import { useSessionMessageMutations } from "./features/sessions/useSessionMessageMutations";
import { useSessionViewModel } from "./features/sessions/useSessionViewModel";
import {
  useGeneratedArtifactBatchRecovery,
  useStaleArtifactEditSweep
} from "./features/sessions/useSessionMaintenance";
import { useFreshChatRunSender } from "./features/chat/useFreshChatRunSender";
import { useRestoredChatRuns } from "./features/chat/useRestoredChatRuns";
import { useArtifactSelections } from "./features/artifacts/useArtifactSelections";
import { isArtifactSelectionTargetActive } from "./features/artifacts/artifactSelectionController";
import { useArtifactActions } from "./features/artifacts/useArtifactActions";
import { useArtifactEditController } from "./features/artifacts/useArtifactEditController";
import { useArtifactEditSelection } from "./features/artifacts/useArtifactEditSelection";
import { artifactSelectionToReference } from "./features/artifacts/artifactMessageProjection";
import { createGeneratedArtifactBatchController } from "./features/artifacts/generatedArtifactBatchController";
import { useVisualRepairController } from "./features/artifacts/useVisualRepairController";
import {
  replayPendingVisualRepair,
  startVisualRepairWithAuthContinuation
} from "./features/artifacts/visualRepairAuthContinuation";
import type { StartVisualRepairInput } from "./features/artifacts/visualRepairController";
import type { ArtifactEditTarget } from "./features/artifacts/artifactEditController";
import { useAppSettings } from "./features/settings/useAppSettings";
import { usePersistentThemeMode } from "./features/settings/usePersistentThemeMode";
import { useSessionRunSettings } from "./features/settings/useSessionRunSettings";
import { useCloudAuthController } from "./features/auth/useCloudAuthController";
import type {
  RenderSnapshot,
  StreamingRenderer
} from "./runtime/streamui/types";

const SESSION_SYNC_INTERVAL_MS = 4_000;
const SESSION_SAVE_DEBOUNCE_MS = 350;

export default function App() {
  const {
    sessionState,
    sessionsLoaded,
    sessionsHydrated,
    sessionStateRef,
    activeSessionIdRef,
    sessionsLoadedRef,
    sessionsHydratedRef,
    deletedSessionIdsRef,
    transientEmptySessionIdRef,
    replaceState: setSessionStateAndRef,
    setSessionsLoaded,
    setSessionsHydrated
  } = useSessionStateController();
  const [themeMode, setThemeMode] = usePersistentThemeMode();
  const {
    apiSettings,
    searchSettings,
    displaySettings,
    profileSettings,
    runtimeSettings,
    cloudEnabled,
    replaceApiSettings: handleApiSettingsChange,
    replaceSearchSettings: handleSearchSettingsChange,
    replaceDisplaySettings: handleDisplaySettingsChange,
    replaceProfileSettings: handleProfileSettingsChange,
    updateApiSettings,
    applyMemoryEvent: handleMemoryStreamEvent
  } = useAppSettings();
  const {
    user: authenticatedUser,
    open: startOAuthAuthentication,
    close: closeAuthOverlay,
    refresh: refreshAuthSummary,
    logout: logoutCloudAccount
  } = useCloudAuthController({ cloudEnabled });
  const [accountMode, setAccountMode] = useState<AccountMode>(loadAccountMode);
  const [isAuthChoiceOpen, setIsAuthChoiceOpen] = useState(false);
  const [providerSettingsRequestVersion, setProviderSettingsRequestVersion] =
    useState(0);
  const openAuthChoice = useCallback(() => {
    setIsAuthChoiceOpen(true);
  }, []);
  const [isSending, setIsSending] = useState(false);
  const {
    activeSession,
    messages,
    sessionItems,
    getBranchInfo,
    activeFiles,
    isActiveSessionSending
  } = useSessionViewModel(sessionState);
  const sessionClientIdRef = useRef(loadSessionClientId());
  const isSendingRef = useRef(isSending);
  const sessionNewOrDeleteBlockedRef = useRef(isSending);
  const sessionSelectionBlockedRef = useRef(false);
  const attachmentDraftsRef = useRef(false);
  const renderersRef = useRef<Map<string, StreamingRenderer>>(new Map());
  const runConnectionsRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledRunIdsRef = useRef<Set<string>>(new Set());
  const [chatRunRuntimeRegistry] = useState(() =>
    createChatRunRuntimeRegistry<ChatRunExecutionController>()
  );
  const [generationActivity] = useState(() =>
    createGenerationActivityCoordinator({
      onBusyChange: (busy) => {
        isSendingRef.current = busy;
        setIsSending(busy);
      }
    })
  );
  const [restoredRunReconnectScheduler] = useState(() =>
    createChatRunReconnectScheduler({
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (timer) => window.clearTimeout(timer as number)
    })
  );
  const [pendingManagedRequestSlot] = useState(
    () => createPendingRequestSlot<PendingManagedRequest>(),
  );
  const [pendingVisualRepairSlot] = useState(
    () => createPendingRequestSlot<StartVisualRepairInput>()
  );
  const {
    getSelections: getArtifactSelections,
    changeSelections: handleArtifactSelectionsChange,
    clearSelections: clearArtifactSelections,
    clearSelectionsForMessage: clearArtifactSelectionsForMessage,
    selectionClearVersion: artifactSelectionClearVersion,
    selectionClearMessageId: artifactSelectionClearMessageId
  } = useArtifactSelections();
  const {
    adapter: attachmentAdapter,
    isSendBlocked: isAttachmentSendBlocked,
    hasComposerDrafts: hasComposerAttachmentDrafts
  } = useSessionAttachmentController({
    activeSessionIdRef,
    sessionClientIdRef
  });
  attachmentDraftsRef.current = hasComposerAttachmentDrafts;
  sessionNewOrDeleteBlockedRef.current = isSending;
  sessionSelectionBlockedRef.current = false;
  const handleAuthOverlayRequest = useCallback(() => {
    pendingVisualRepairSlot.clear();
    openManualAuth(pendingManagedRequestSlot, openAuthChoice);
  }, [openAuthChoice, pendingManagedRequestSlot, pendingVisualRepairSlot]);
  const handleAuthChoiceClose = useCallback(() => {
    setIsAuthChoiceOpen(false);
    pendingManagedRequestSlot.clear();
    pendingVisualRepairSlot.clear();
  }, [pendingManagedRequestSlot, pendingVisualRepairSlot]);
  const handleAuthChoiceSignIn = useCallback(() => {
    setIsAuthChoiceOpen(false);
    startOAuthAuthentication();
  }, [startOAuthAuthentication]);
  const handleContinueLocal = useCallback(() => {
    setIsAuthChoiceOpen(false);
    pendingManagedRequestSlot.clear();
    pendingVisualRepairSlot.clear();
    setAccountMode("local");
    saveAccountMode("local");
    setProviderSettingsRequestVersion((current) => current + 1);
  }, [pendingManagedRequestSlot, pendingVisualRepairSlot]);
  const handleLogout = useCallback(async () => {
    try {
      await logoutCloudAccount();
    } finally {
      pendingManagedRequestSlot.clear();
      pendingVisualRepairSlot.clear();
    }
  }, [logoutCloudAccount, pendingManagedRequestSlot, pendingVisualRepairSlot]);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    restoredRunReconnectScheduler.activate();
    return () => {
      runConnectionsRef.current.forEach((controller) => controller.abort());
      runConnectionsRef.current.clear();
      cancelledRunIdsRef.current.clear();
      restoredRunReconnectScheduler.dispose();
      generationActivity.reset();
    };
  }, [generationActivity, restoredRunReconnectScheduler]);

  useEffect(() => {
    if (!cloudEnabled) {
      pendingManagedRequestSlot.clear();
      pendingVisualRepairSlot.clear();
    }
  }, [cloudEnabled, pendingManagedRequestSlot, pendingVisualRepairSlot]);

  const sessionListPreview = useSessionIndex({
    sessionState,
    sessionsHydrated,
    sessionClientIdRef,
    sessionsHydratedRef
  });

  useSessionSync({
    sessionsLoaded,
    intervalMs: SESSION_SYNC_INTERVAL_MS,
    sessionClientIdRef,
    sessionStateRef,
    sessionsLoadedRef,
    sessionsHydratedRef,
    deletedSessionIdsRef,
    transientEmptySessionIdRef,
    runConnectionsRef,
    cancelledRunIdsRef,
    attachmentDraftsRef,
    updateState: setSessionStateAndRef,
    setSessionsLoaded,
    setSessionsHydrated
  });

  useStaleArtifactEditSweep(sessionsLoaded, setSessionStateAndRef);

  const saveCurrentSessionStateNow = useSessionSave({
    sessionState,
    sessionsLoaded,
    debounceMs: SESSION_SAVE_DEBOUNCE_MS,
    sessionStateRef,
    sessionsLoadedRef,
    sessionClientIdRef,
    deletedSessionIdsRef
  });

  useGeneratedArtifactBatchRecovery({
    sessions: sessionState.sessions,
    sessionsLoaded,
    sessionStateRef,
    cancelledRunIdsRef,
    themeMode,
    replaceState: setSessionStateAndRef,
    saveNow: saveCurrentSessionStateNow
  });

  const {
    updateActiveSession,
    updateSessionById,
    createNewSession: handleNewSession,
    selectSession: handleSelectSession,
    deleteSession: handleDeleteSession
  } = useSessionActions({
    sessionStateRef,
    isNewOrDeleteBlockedRef: sessionNewOrDeleteBlockedRef,
    isSelectionBlockedRef: sessionSelectionBlockedRef,
    transientEmptySessionIdRef,
    deletedSessionIdsRef,
    replaceState: setSessionStateAndRef,
    saveNow: saveCurrentSessionStateNow,
    defaultModel: apiSettings.model,
    defaultReasoningEffort: apiSettings.reasoningEffort,
    defaultUiComplexity: apiSettings.uiComplexity
  });
  const selectSessionRef = useRef(handleSelectSession);
  selectSessionRef.current = handleSelectSession;
  const [deferredSessionSelection] = useState(() =>
    createDeferredSessionSelectionController({
      hasSession: (sessionId) =>
        sessionStateRef.current.sessions.some(
          (session) => session.id === sessionId
        ),
      selectSession: (sessionId) => selectSessionRef.current(sessionId)
    })
  );
  const requestSidebarSessionSelection = useCallback(
    (sessionId: string) => {
      deferredSessionSelection.request(
        sessionId,
        sessionsHydratedRef.current
      );
    },
    [deferredSessionSelection, sessionsHydratedRef]
  );

  useEffect(() => {
    if (sessionsHydrated) {
      deferredSessionSelection.flush(true);
      return;
    }
    if (sessionsLoaded) {
      deferredSessionSelection.clear();
    }
  }, [deferredSessionSelection, sessionsHydrated, sessionsLoaded]);

  const {
    model: activeSessionModel,
    reasoningEffort: activeSessionReasoningEffort,
    uiComplexity: activeSessionUiComplexity,
    selectableModels,
    changeModel: handleModelChange,
    changeReasoningEffort: handleReasoningEffortChange,
    changeUiComplexity: handleUiComplexityChange
  } = useSessionRunSettings({
    session: activeSession,
    apiSettings,
    updateApiSettings,
    updateActiveSession
  });

  const {
    session: bugReportSession,
    draft: bugReportDraft,
    isOpen: isBugReportOpen,
    isSubmitting: isBugReportSubmitting,
    isSubmitted: isBugReportSubmitted,
    captureError: bugReportCaptureError,
    submitError: bugReportSubmitError,
    open: handleBugReportOpen,
    changeDraft: handleBugReportDraftChange,
    close: handleBugReportClose,
    submit: handleBugReportSubmit
  } = useBugReportController({
    sessionState,
    sessionStateRef,
    activeSessionIdRef,
    sessionClientIdRef,
    updateSessionById,
    saveNow: saveCurrentSessionStateNow
  });

  const {
    upsertSessionFiles,
    updateAssistantMessage,
    updateAssistantMessageInSession,
    mutateArtifactEditMessage,
    appendRuntimeError: handleRuntimeError
  } = useSessionMessageMutations(setSessionStateAndRef);

  const clearArtifactSelectionsForTarget = useCallback(
    (target: ArtifactEditTarget) => {
      if (
        !isArtifactSelectionTargetActive(
          activeSessionIdRef.current,
          target.sessionId
        )
      ) {
        return;
      }
      clearArtifactSelectionsForMessage(target.assistantId);
    },
    [clearArtifactSelectionsForMessage]
  );

  const {
    runSourceEdit: runArtifactSourceEdit,
    regenerate: regenerateArtifactEditNode,
    editPrompt: handleEditArtifactEditPrompt,
    cancelActive: cancelActiveArtifactEdit,
    isRunning: isLocalArtifactEditRunning
  } = useArtifactEditController({
    sessionStateRef,
    activeSessionIdRef,
    sessionClientIdRef,
    apiSettings,
    runtimeSettings,
    cloudEnabled,
    authenticated: Boolean(authenticatedUser),
    themeMode,
    isBusy: generationActivity.isBusy,
    mutateMessage: mutateArtifactEditMessage,
    tryAcquireBusy: generationActivity.tryAcquireLocal,
    clearSelections: clearArtifactSelectionsForTarget,
    openAuthentication: openAuthChoice,
    saveNow: saveCurrentSessionStateNow,
    refreshAuthentication: refreshAuthSummary
  });

  const handleSelectBranch = useCallback(
    (groupId: string, variantId: string) => {
      updateActiveSession((session) => ({
        ...session,
        branchSelections: {
          ...(session.branchSelections ?? {}),
          [groupId]: variantId
        },
        updatedAt: Date.now()
      }));
      clearArtifactSelections();
    },
    [clearArtifactSelections, updateActiveSession]
  );

  const sendStreamUiRequest = useFreshChatRunSender({
    activeSessionIdRef,
    sessionStateRef,
    sessionClientIdRef,
    transientEmptySessionIdRef,
    runConnectionsRef,
    renderersRef,
    apiSettings,
    searchSettings,
    runtimeSettings,
    themeMode,
    cloudEnabled,
    authenticatedUser,
    generationActivity,
    chatRunRuntimeRegistry,
    pendingManagedRequestSlot,
    openAuthOverlay: openAuthChoice,
    refreshAuthSummary,
    handleMemoryStreamEvent,
    updateAssistantMessageInSession,
    updateSessionById,
    upsertSessionFiles
  });

  const startBranchedTurn = useCallback(
    ({
      session,
      visibleMessages,
      userIndex,
      assistantId,
      nextUserContent,
      attachments = [],
      appendUserMessage = true,
      userMessagePatch,
      assistantPatch,
      initialReasoning,
      requestHistory,
      preserveFollowingMessages = false
    }: MessageRevisionBranchInput) => {
      if (generationActivity.isBusy()) {
        return false;
      }

      const activeUser = visibleMessages[userIndex];
      if (!activeUser || activeUser.role !== "user") {
        return false;
      }

      const activeAssistant = assistantId
        ? visibleMessages.find((message) => message.id === assistantId)
        : getAssistantForUserTurn(visibleMessages, userIndex);
      const plan = createBranchTurnPlan(
        {
          session,
          visibleMessages,
          userIndex,
          activeUser,
          activeAssistant,
          appendUserMessage,
          userMessagePatch,
          assistantPatch,
          preserveFollowingMessages
        },
        createId
      );

      void sendStreamUiRequest(nextUserContent, attachments, {
        ...plan,
        initialReasoning,
        targetSessionId: session.id,
        requestHistory: requestHistory ?? plan.requestHistory
      });
      return true;
    },
    [generationActivity, sendStreamUiRequest]
  );

  const generatedArtifactBatchController = useMemo(
    () =>
      createGeneratedArtifactBatchController({
        getState: () => sessionStateRef.current,
        isBusy: generationActivity.isBusy,
        sendRequest: sendStreamUiRequest,
        saveNow: saveCurrentSessionStateNow,
        themeMode
      }),
    [
      generationActivity,
      saveCurrentSessionStateNow,
      sendStreamUiRequest,
      themeMode
    ]
  );

  const startGeneratedArtifactBatch = generatedArtifactBatchController.start;

  const {
    start: startVisualRepair,
    cancelActive: cancelActiveVisualRepair,
    getActiveRun: getActiveVisualRepairRun,
    isRunning: isVisualRepairRunning
  } = useVisualRepairController({
    sessionStateRef,
    apiSettings,
    runtimeSettings,
    cloudEnabled,
    authenticated: Boolean(authenticatedUser),
    themeMode,
    isBusy: generationActivity.isBusy,
    tryAcquireLocal: generationActivity.tryAcquireLocal,
    promoteLocalToChat: generationActivity.promoteLocalToChat,
    startGeneratedBatch: startGeneratedArtifactBatch,
    openAuthentication: openAuthChoice
  });

  const handleVisualRepairAssistant = useCallback(
    (assistantId: string, snapshot: RenderSnapshot, width: number) => {
      const request: StartVisualRepairInput = {
        sessionId: activeSessionIdRef.current,
        assistantId,
        snapshot,
        width
      };
      pendingVisualRepairSlot.clear();
      void startVisualRepairWithAuthContinuation(
        request,
        startVisualRepair,
        pendingVisualRepairSlot
      ).catch((error) => {
        console.warn("Could not start visual artifact repair.", error);
      });
    },
    [pendingVisualRepairSlot, startVisualRepair]
  );

  useEffect(() => {
    if (!authenticatedUser || isSending) {
      return;
    }
    if (pendingVisualRepairSlot.peek()) {
      closeAuthOverlay();
    }
    replayPendingVisualRepair(
      pendingVisualRepairSlot,
      startVisualRepair,
      (message, error) => console.warn(message, error)
    );
  }, [
    authenticatedUser,
    closeAuthOverlay,
    isSending,
    pendingVisualRepairSlot,
    startVisualRepair
  ]);

  const handleCancelRun = useChatRunCancellation({
    sessionStateRef,
    activeSessionIdRef,
    sessionClientIdRef,
    cancelledRunIdsRef,
    runConnectionsRef,
    themeMode,
    runtimeRegistry: chatRunRuntimeRegistry,
    reconnectScheduler: restoredRunReconnectScheduler,
    generationActivity,
    updateState: setSessionStateAndRef,
    saveNow: saveCurrentSessionStateNow,
    cancelActiveArtifactEdit,
    cancelActiveVisualRepair,
    getActiveVisualRepairRun
  });

  const messageRevisionController = useMemo(
    () =>
      createMessageRevisionController({
        getState: () => sessionStateRef.current,
        getActiveSessionId: () => activeSessionIdRef.current,
        isBusy: generationActivity.isBusy,
        regenerateArtifactEdit: regenerateArtifactEditNode,
        startGeneratedArtifactBatch,
        startVisualRepair: handleVisualRepairAssistant,
        startBranchedTurn
      }),
    [
      handleVisualRepairAssistant,
      generationActivity,
      regenerateArtifactEditNode,
      startBranchedTurn,
      startGeneratedArtifactBatch
    ]
  );
  const handleRegenerateAssistant =
    messageRevisionController.regenerateAssistant;
  const handleEditUserMessage = messageRevisionController.editUserMessage;

  const sendArtifactActionMessage = useCallback(
    (text: string, targetSessionId: string) => {
      void sendStreamUiRequest(text, [], { targetSessionId });
    },
    [sendStreamUiRequest]
  );
  const handleArtifactAction = useArtifactActions({
    isSending,
    isSendingRef,
    sessionStateRef,
    sendActionMessage: sendArtifactActionMessage
  });

  useRestoredChatRuns({
    sessionsLoaded,
    sessions: sessionState.sessions,
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
  });

  useEffect(() => {
    if (!cloudEnabled || !authenticatedUser || !sessionsLoaded) {
      return;
    }

    replayManagedAuthRequest(
      pendingManagedRequestSlot,
      closeAuthOverlay,
      (pending) => {
        void sendStreamUiRequest(
          pending.text,
          pending.attachments,
          pending.options
        );
      }
    );
  }, [
    authenticatedUser,
    closeAuthOverlay,
    cloudEnabled,
    pendingManagedRequestSlot,
    sendStreamUiRequest,
    sessionsLoaded
  ]);

  const handleSelectArtifactEdit = useArtifactEditSelection({
    themeMode,
    updateMessage: updateAssistantMessage,
    clearSelections: clearArtifactSelections
  });

  const handleNewMessage = useCallback(
    async (message: AppendMessage) => {
      if (
        isAttachmentSendBlocked
      ) {
        return;
      }

      const text = getAppendMessageText(message);
      const attachments = getAppendMessageImages(message);
      await submitComposerMessage(text, attachments, {
        getSelections: getArtifactSelections,
        runSourceEdit: runArtifactSourceEdit,
        startArtifactGeneration: async (
          prompt,
          artifactSelections,
          artifactAttachments
        ) => {
          const selectedMessageIds = Array.from(
            new Set(artifactSelections.map((selection) => selection.messageId))
          );
          const assistantId = selectedMessageIds[0];
          const session = sessionStateRef.current.sessions.find(
            (candidate) => candidate.id === activeSessionIdRef.current
          );
          if (!session || !assistantId || selectedMessageIds.length !== 1) {
            return false;
          }

          const visibleMessages = getVisibleSessionMessages(session);
          const assistantIndex = visibleMessages.findIndex(
            (candidate) =>
              candidate.id === assistantId && candidate.role === "assistant"
          );
          let sourceUserMessageId = "";
          for (let index = assistantIndex - 1; index >= 0; index -= 1) {
            if (visibleMessages[index]?.role === "user") {
              sourceUserMessageId = visibleMessages[index].id;
              break;
            }
          }
          if (assistantIndex < 0 || !sourceUserMessageId || !prompt.trim()) {
            return false;
          }

          const result = startGeneratedArtifactBatch({
            sessionId: session.id,
            assistantId,
            sourceUserMessageId,
            prompt,
            references: artifactSelections.map(artifactSelectionToReference),
            attachments: artifactAttachments,
            ephemeralAttachments: true,
            historyMode: "through-target-assistant",
            initialReasoning: "Thinking",
            onRunInitialized: () => undefined,
            onRunAccepted: clearArtifactSelections
          });
          if (result.status !== "started") {
            return false;
          }
          return result.initialization;
        },
        sendChat: (chatText, chatAttachments) => {
          clearArtifactSelections();
          return sendStreamUiRequest(chatText, chatAttachments);
        }
      });
    },
    [
      activeSessionIdRef,
      clearArtifactSelections,
      isAttachmentSendBlocked,
      getArtifactSelections,
      runArtifactSourceEdit,
      sendStreamUiRequest,
      sessionStateRef,
      startGeneratedArtifactBatch
    ]
  );

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning:
      isActiveSessionSending ||
      isLocalArtifactEditRunning ||
      isVisualRepairRunning,
    isSendDisabled:
      isSending ||
      isAttachmentSendBlocked,
    convertMessage,
    onNew: handleNewMessage,
    onCancel: handleCancelRun,
    adapters: {
      attachments: attachmentAdapter
    }
  });

  const discardComposerAttachmentsForSessionAction = useCallback(
    (action: () => void) => {
      attachmentDraftsRef.current = false;
      discardComposerAttachmentsAndRun(
        {
          clearAttachments: () => runtime.thread.composer.clearAttachments(),
          onClearError: (error) =>
            console.warn("Could not clear composer attachments.", error)
        },
        action
      );
    },
    [attachmentDraftsRef, runtime]
  );
  const handleSidebarNewSession = useCallback(() => {
    discardComposerAttachmentsForSessionAction(() => {
      handleNewSession();
    });
  }, [discardComposerAttachmentsForSessionAction, handleNewSession]);
  const handleSidebarSelectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === activeSessionIdRef.current) {
        requestSidebarSessionSelection(sessionId);
        return;
      }
      discardComposerAttachmentsForSessionAction(() => {
        requestSidebarSessionSelection(sessionId);
      });
    },
    [
      activeSessionIdRef,
      discardComposerAttachmentsForSessionAction,
      requestSidebarSessionSelection
    ]
  );
  const handleSidebarDeleteSession = useCallback(
    (sessionId: string) => {
      if (sessionId !== activeSessionIdRef.current) {
        handleDeleteSession(sessionId);
        return;
      }
      discardComposerAttachmentsForSessionAction(() => {
        handleDeleteSession(sessionId);
      });
    },
    [
      activeSessionIdRef,
      discardComposerAttachmentsForSessionAction,
      handleDeleteSession
    ]
  );

  const sidebarPreview =
    !sessionsLoaded && sessionListPreview ? sessionListPreview : null;
  const sidebarSessionItems = sidebarPreview?.sessions ?? sessionItems;
  const sidebarActiveSessionId =
    sidebarPreview?.activeSessionId ?? sessionState.activeSessionId;
  return (
    <>
      <AssistantRuntimeProvider runtime={runtime}>
        <ChatShell
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
          sidebar={
            <SessionSidebar
              sessions={sidebarSessionItems}
              activeSessionId={sidebarActiveSessionId}
              isSending={isSending}
              isSessionSelectionBlocked={false}
              themeMode={themeMode}
              apiSettings={apiSettings}
              searchSettings={searchSettings}
              displaySettings={displaySettings}
              profileSettings={profileSettings}
              runtimeSettings={runtimeSettings}
              cloudEnabled={cloudEnabled}
              accountMode={accountMode}
              authUser={authenticatedUser}
              onNewSession={handleSidebarNewSession}
              onSelectSession={handleSidebarSelectSession}
              onDeleteSession={handleSidebarDeleteSession}
              onApiSettingsChange={handleApiSettingsChange}
              onSearchSettingsChange={handleSearchSettingsChange}
              onDisplaySettingsChange={handleDisplaySettingsChange}
              onProfileSettingsChange={handleProfileSettingsChange}
              onLoginRequest={handleAuthOverlayRequest}
              onLogout={handleLogout}
              onBugReportOpen={() => void handleBugReportOpen()}
              providerSettingsRequestVersion={providerSettingsRequestVersion}
            />
          }
        >
          <StreamThread
            activeSessionId={sessionState.activeSessionId}
            messages={messages}
            files={activeFiles}
            getBranchInfo={getBranchInfo}
            themeMode={themeMode}
            showRawStream={displaySettings.showRawStream}
            artifactEditingEnabled={
              displaySettings.artifactEditingEnabled
            }
            model={activeSessionModel}
            modelOptions={selectableModels}
            reasoningEffort={activeSessionReasoningEffort}
            uiComplexity={activeSessionUiComplexity}
            artifactSelectionClearVersion={artifactSelectionClearVersion}
            artifactSelectionClearMessageId={artifactSelectionClearMessageId}
            onRuntimeError={handleRuntimeError}
            onArtifactAction={handleArtifactAction}
            onVisualRepairAssistant={handleVisualRepairAssistant}
            onRegenerateAssistant={handleRegenerateAssistant}
            onEditUserMessage={handleEditUserMessage}
            onSelectBranch={handleSelectBranch}
            onSelectArtifactEdit={handleSelectArtifactEdit}
            onEditArtifactEditPrompt={handleEditArtifactEditPrompt}
            onArtifactSelectionsChange={handleArtifactSelectionsChange}
            onModelChange={handleModelChange}
            onReasoningEffortChange={handleReasoningEffortChange}
            onUiComplexityChange={handleUiComplexityChange}
          />
        </ChatShell>
      </AssistantRuntimeProvider>
      {isAuthChoiceOpen ? (
        <AuthChoiceDialog
          themeMode={themeMode}
          onClose={handleAuthChoiceClose}
          onSignIn={handleAuthChoiceSignIn}
          onContinueLocal={handleContinueLocal}
        />
      ) : null}
      {isBugReportOpen && bugReportSession ? (
        <BugReportDialog
          draft={bugReportDraft}
          themeMode={themeMode}
          captureError={bugReportCaptureError}
          submitError={bugReportSubmitError}
          isSubmitting={isBugReportSubmitting}
          isSubmitted={isBugReportSubmitted}
          onChange={handleBugReportDraftChange}
          onClose={handleBugReportClose}
          onSubmit={() => void handleBugReportSubmit()}
        />
      ) : null}
    </>
  );
}
