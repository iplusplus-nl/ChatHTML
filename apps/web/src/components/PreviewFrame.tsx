import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyTextToClipboard,
  downloadTextFile
} from "../core/artifactExport";
import {
  clearIframeCaptureSource,
  setIframeCaptureSource
} from "../core/iframeCaptureSource";
import { isIgnoredRuntimeError } from "../core/ignoredRuntimeErrors";
import type { ArtifactSelectionPayload } from "../core/artifactSelection";
import {
  normalizeCapabilityLabel,
  normalizeCapabilityText,
  normalizeOpenUrl,
  sanitizeDownloadFilename,
  sanitizeMimeType,
  type PreviewCapabilityAction
} from "../features/artifacts/previewCapabilityModel";
import {
  ArtifactCapabilityPanel,
  type ArtifactCapabilityStatus
} from "./ArtifactCapabilityPanel";
import {
  normalizeArtifactSelectionPayload,
  type PreviewSelectionTarget
} from "../features/artifacts/previewSelectionPayload";
import {
  PREVIEW_HEIGHT_SHRINK_SETTLE_MS,
  applyPreviewHeightMeasurement,
  settlePendingPreviewHeight,
  type PendingPreviewHeightShrink,
  type PreviewHeightDecision
} from "../features/artifacts/previewHeightModel";
import {
  PREVIEW_IFRAME_SANDBOX,
  createPreviewChannelToken,
  createPreviewHostRenderMessage,
  createPreviewHostThemeMessage
} from "../features/artifacts/previewFrameSandbox";
import { openPreviewExternalUrl } from "../features/artifacts/previewExternalOpen";
import { dispatchPreviewPromptAction } from "../features/artifacts/previewPromptAction";
import {
  createPreviewFrameDocument,
  previewFrameDocumentMatches,
  type PreviewFrameDocumentMode
} from "../features/artifacts/previewFrameDocumentModel";
import { buildIframeDocument } from "../runtime/streamui/sandboxDocument";
import type {
  PageThemeMode,
  RenderError,
  RenderSnapshot,
  StreamUiAction
} from "../runtime/streamui/types";

type PreviewFrameProps = {
  snapshot: RenderSnapshot;
  themeMode: PageThemeMode;
  selectionModeActive?: boolean;
  selectedSelections?: PreviewSelectionTarget[];
  busySelections?: PreviewSelectionTarget[];
  onRuntimeError(error: RenderError): void;
  onArtifactAction(action: StreamUiAction): void;
  onArtifactSelection?(selection: ArtifactSelectionPayload): void;
  onSelectionModeChange?(enabled: boolean): void;
};

export function PreviewFrame({
  snapshot,
  themeMode,
  selectionModeActive = false,
  selectedSelections = [],
  busySelections = [],
  onRuntimeError,
  onArtifactAction,
  onArtifactSelection,
  onSelectionModeChange
}: PreviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const channelTokenRef = useRef("");
  const lastAppliedBodyHtmlRef = useRef("");
  const lastAppliedThemeModeRef = useRef<PageThemeMode | null>(null);
  const pendingShrinkRef = useRef<PendingPreviewHeightShrink | null>(null);
  const pendingShrinkTimerRef = useRef<number | null>(null);
  const [height, setHeight] = useState(96);
  const [capabilityAction, setCapabilityAction] =
    useState<PreviewCapabilityAction | null>(null);
  const [capabilityStatus, setCapabilityStatus] =
    useState<ArtifactCapabilityStatus | null>(null);
  const artifactActionsEnabled = snapshot.status === "complete";
  const [frameDocument, setFrameDocument] = useState(() =>
    createPreviewFrameDocument({
      epoch: 0,
      mode: artifactActionsEnabled ? "complete" : "streaming",
      completedHtml: snapshot.completedHtml,
      themeMode,
      channelToken: createPreviewChannelToken(),
      documentEpoch: createPreviewChannelToken()
    })
  );
  channelTokenRef.current = frameDocument.channelToken;

  const applyMeasuredHeight = useCallback((value: number) => {
    const clearPendingShrinkTimer = () => {
      if (pendingShrinkTimerRef.current !== null) {
        window.clearTimeout(pendingShrinkTimerRef.current);
        pendingShrinkTimerRef.current = null;
      }
    };
    const schedulePendingShrink = (startedAt: number) => {
      clearPendingShrinkTimer();
      const elapsed = performance.now() - startedAt;
      const delay = Math.max(0, PREVIEW_HEIGHT_SHRINK_SETTLE_MS - elapsed) + 20;
      pendingShrinkTimerRef.current = window.setTimeout(() => {
        pendingShrinkTimerRef.current = null;
        setHeight((currentHeight) => {
          const decision = settlePendingPreviewHeight(
            currentHeight,
            pendingShrinkRef.current,
            performance.now()
          );
          applyDecision(decision);
          return decision.height;
        });
      }, delay);
    };

    const applyDecision = (decision: PreviewHeightDecision) => {
      pendingShrinkRef.current = decision.pending;
      if (decision.scheduleStartedAt !== null) {
        schedulePendingShrink(decision.scheduleStartedAt);
      } else {
        clearPendingShrinkTimer();
      }
    };

    setHeight((currentHeight) => {
      const decision = applyPreviewHeightMeasurement(
        currentHeight,
        pendingShrinkRef.current,
        value,
        performance.now()
      );
      applyDecision(decision);
      return decision.height;
    });
  }, []);

  useEffect(
    () => () => {
      if (pendingShrinkTimerRef.current !== null) {
        window.clearTimeout(pendingShrinkTimerRef.current);
        pendingShrinkTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    pendingShrinkRef.current = null;
    if (pendingShrinkTimerRef.current !== null) {
      window.clearTimeout(pendingShrinkTimerRef.current);
      pendingShrinkTimerRef.current = null;
    }
  }, [frameDocument.epoch]);

  const requestFrameMeasure = useCallback(() => {
    window.requestAnimationFrame(() => {
      frameRef.current?.contentWindow?.postMessage(
        {
          source: "streamui-host",
          documentEpoch: frameDocument.documentEpoch,
          kind: "measure"
        },
        "*"
      );
    });
  }, [frameDocument.documentEpoch]);

  const postSelectionState = useCallback(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) {
      return;
    }

    frameWindow.postMessage(
      {
        source: "streamui-host",
        documentEpoch: frameDocument.documentEpoch,
        kind: "selection-mode",
        enabled: Boolean(selectionModeActive && artifactActionsEnabled)
      },
      "*"
    );
    frameWindow.postMessage(
      {
        source: "streamui-host",
        documentEpoch: frameDocument.documentEpoch,
        kind: "selection-targets",
        targets: selectedSelections.map((selection) => ({
          key: selection.key,
          kind: selection.kind,
          selector: selection.selector,
          label: selection.label,
          preview: selection.preview
        }))
      },
      "*"
    );
    frameWindow.postMessage(
      {
        source: "streamui-host",
        documentEpoch: frameDocument.documentEpoch,
        kind: "selection-busy-targets",
        targets: busySelections.map((selection) => ({
          key: selection.key,
          kind: selection.kind,
          selector: selection.selector
        }))
      },
      "*"
    );
  }, [
    artifactActionsEnabled,
    busySelections,
    frameDocument.documentEpoch,
    selectedSelections,
    selectionModeActive
  ]);

  const applySnapshotToFrame = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const desiredMode: PreviewFrameDocumentMode = artifactActionsEnabled
      ? "complete"
      : "streaming";
    if (
      !previewFrameDocumentMatches(
        frameDocument,
        desiredMode,
        snapshot.completedHtml,
        themeMode
      )
    ) {
      lastAppliedBodyHtmlRef.current = "";
      lastAppliedThemeModeRef.current = null;
      setFrameDocument((current) => {
        if (
          previewFrameDocumentMatches(
            current,
            desiredMode,
            snapshot.completedHtml,
            themeMode
          )
        ) {
          return current;
        }

        return createPreviewFrameDocument({
          epoch: current.epoch + 1,
          mode: desiredMode,
          completedHtml: snapshot.completedHtml,
          themeMode,
          channelToken: createPreviewChannelToken(),
          documentEpoch: createPreviewChannelToken()
        });
      });
      return;
    }

    if (desiredMode === "complete") {
      if (lastAppliedThemeModeRef.current !== themeMode) {
        frame.contentWindow?.postMessage(
          createPreviewHostThemeMessage(
            themeMode,
            frameDocument.documentEpoch
          ),
          "*"
        );
        lastAppliedThemeModeRef.current = themeMode;
      }
      requestFrameMeasure();
      return;
    }

    const message = createPreviewHostRenderMessage(
      snapshot.completedHtml,
      themeMode,
      frameDocument.documentEpoch
    );
    if (lastAppliedBodyHtmlRef.current !== message.bodyHtml) {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        return;
      }
      frameWindow.postMessage(message, "*");
      lastAppliedBodyHtmlRef.current = message.bodyHtml;
      lastAppliedThemeModeRef.current = themeMode;
      return;
    }

    if (lastAppliedThemeModeRef.current !== themeMode) {
      frame.contentWindow?.postMessage(
        createPreviewHostThemeMessage(themeMode, frameDocument.documentEpoch),
        "*"
      );
      lastAppliedThemeModeRef.current = themeMode;
      return;
    }

    requestFrameMeasure();
  }, [
    artifactActionsEnabled,
    frameDocument,
    requestFrameMeasure,
    snapshot.completedHtml,
    themeMode
  ]);

  const postCapabilityResult = useCallback(
    (capabilityId: string, ok: boolean, message = "") => {
      frameRef.current?.contentWindow?.postMessage(
        {
          source: "streamui-host",
          documentEpoch: frameDocument.documentEpoch,
          kind: "capability-result",
          capabilityId,
          ok,
          message
        },
        "*"
      );
    },
    [frameDocument.documentEpoch]
  );

  const sendCapabilityResult = useCallback(
    (action: PreviewCapabilityAction, ok: boolean, message = "") => {
      if (action.capabilityId) {
        postCapabilityResult(action.capabilityId, ok, message);
      }
    },
    [postCapabilityResult]
  );

  const cancelCapabilityAction = useCallback(() => {
    if (capabilityAction) {
      sendCapabilityResult(
        capabilityAction,
        false,
        "The user cancelled this action."
      );
    }
    setCapabilityAction(null);
  }, [capabilityAction, sendCapabilityResult]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) {
        return;
      }

      const data = event.data as {
        source?: string;
        channelToken?: string;
        kind?:
          | RenderError["kind"]
          | "resize"
          | "action"
          | "escape"
          | "wheel"
          | "selection"
          | "selection-mode-change";
        actionType?: string;
        status?: string;
        count?: number;
        prompt?: string;
        capabilityId?: string;
        label?: string;
        text?: string;
        url?: string;
        filename?: string;
        mimeType?: string;
        message?: string;
        height?: number;
        deltaY?: number;
        deltaMode?: number;
        enabled?: boolean;
        selection?: unknown;
      };

      if (
        data?.source !== "streamui-runtime" ||
        data.channelToken !== channelTokenRef.current
      ) {
        return;
      }

      if (data.kind === "readability" && data.status === "clear") {
        onRuntimeError({
          kind: "readability",
          message: "",
          timestamp: Date.now()
        });
        return;
      }

      if (data.kind === "wheel" && Number.isFinite(data.deltaY)) {
        const viewport = frameRef.current?.closest<HTMLElement>(".message-list");
        if (!viewport) {
          return;
        }

        const deltaScale =
          data.deltaMode === 1
            ? 16
            : data.deltaMode === 2
              ? viewport.clientHeight
              : 1;
        const deltaY = (data.deltaY ?? 0) * deltaScale;
        const maxDelta = Math.max(1, viewport.clientHeight * 0.9);
        viewport.scrollTop += Math.max(-maxDelta, Math.min(deltaY, maxDelta));
        return;
      }

      if (data.kind === "action" && !artifactActionsEnabled) {
        return;
      }

      if (data.kind === "escape") {
        cancelCapabilityAction();
        return;
      }

      if (data.kind === "selection-mode-change") {
        onSelectionModeChange?.(Boolean(data.enabled));
        return;
      }

      if (data.kind === "selection") {
        if (!artifactActionsEnabled) {
          return;
        }

        const selection = normalizeArtifactSelectionPayload(data.selection);
        if (selection) {
          onArtifactSelection?.(selection);
        }
        return;
      }

      if (data.kind === "action" && data.actionType === "prompt") {
        dispatchPreviewPromptAction(
          data,
          onArtifactAction,
          (capabilityId) => postCapabilityResult(capabilityId, true)
        );
        return;
      }

      if (data.kind === "action" && data.actionType === "copy") {
        setCapabilityStatus(null);
        setCapabilityAction({
          type: "copy",
          ...(typeof data.capabilityId === "string" && data.capabilityId
            ? { capabilityId: data.capabilityId }
            : {}),
          text: normalizeCapabilityText(data.text),
          ...(normalizeCapabilityLabel(data.label)
            ? { label: normalizeCapabilityLabel(data.label) }
            : {})
        });
        return;
      }

      if (data.kind === "action" && data.actionType === "download") {
        setCapabilityStatus(null);
        setCapabilityAction({
          type: "download",
          ...(typeof data.capabilityId === "string" && data.capabilityId
            ? { capabilityId: data.capabilityId }
            : {}),
          text: normalizeCapabilityText(data.text),
          filename: sanitizeDownloadFilename(data.filename),
          mimeType: sanitizeMimeType(data.mimeType),
          ...(normalizeCapabilityLabel(data.label)
            ? { label: normalizeCapabilityLabel(data.label) }
            : {})
        });
        return;
      }

      if (data.kind === "action" && data.actionType === "open-url") {
        try {
          setCapabilityStatus(null);
          setCapabilityAction({
            type: "open-url",
            ...(typeof data.capabilityId === "string" && data.capabilityId
              ? { capabilityId: data.capabilityId }
              : {}),
            url: normalizeOpenUrl(data.url, window.location.href),
            ...(normalizeCapabilityLabel(data.label)
              ? { label: normalizeCapabilityLabel(data.label) }
              : {})
          });
        } catch (error) {
          setCapabilityStatus({
            kind: "error",
            message: error instanceof Error ? error.message : "Invalid URL."
          });
        }
        return;
      }

      if (data.kind === "resize" && typeof data.height === "number") {
        applyMeasuredHeight(data.height);
        return;
      }

      const kind: RenderError["kind"] =
        data.kind === "console" || data.kind === "readability"
          ? data.kind
          : "runtime";
      const runtimeError = {
        kind,
        message: data.message || "Unknown iframe runtime event.",
        filename: data.filename,
        timestamp: Date.now()
      };

      if (isIgnoredRuntimeError(runtimeError)) {
        return;
      }

      onRuntimeError(runtimeError);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    applyMeasuredHeight,
    artifactActionsEnabled,
    cancelCapabilityAction,
    onArtifactAction,
    onArtifactSelection,
    onSelectionModeChange,
    onRuntimeError,
    postCapabilityResult
  ]);

  useEffect(() => {
    applySnapshotToFrame();
  }, [applySnapshotToFrame]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return undefined;
    }

    setIframeCaptureSource(
      frame,
      buildIframeDocument(
        snapshot.completedHtml,
        themeMode,
        snapshot.status === "complete"
      )
    );
    return () => clearIframeCaptureSource(frame);
  }, [snapshot.completedHtml, snapshot.status, themeMode]);

  useEffect(() => {
    postSelectionState();
  }, [postSelectionState]);

  useEffect(() => {
    if (!capabilityStatus || capabilityStatus.kind === "error") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCapabilityStatus(null);
    }, 2_200);

    return () => window.clearTimeout(timeoutId);
  }, [capabilityStatus]);

  const runCapabilityAction = async () => {
    if (!capabilityAction) {
      return;
    }

    try {
      if (capabilityAction.type === "copy") {
        if (!capabilityAction.text) {
          throw new Error("Nothing to copy.");
        }
        await copyTextToClipboard(capabilityAction.text);
        setCapabilityStatus({ kind: "success", message: "Copied" });
        sendCapabilityResult(capabilityAction, true);
      } else if (capabilityAction.type === "download") {
        if (!capabilityAction.text) {
          throw new Error("Nothing to download.");
        }
        downloadTextFile(
          capabilityAction.text,
          capabilityAction.filename || "chathtml-export.txt",
          capabilityAction.mimeType
        );
        setCapabilityStatus({ kind: "success", message: "Download started" });
        sendCapabilityResult(capabilityAction, true);
      } else {
        openPreviewExternalUrl(
          capabilityAction.url,
          window.open.bind(window)
        );
        setCapabilityStatus({ kind: "success", message: "Opened" });
        sendCapabilityResult(capabilityAction, true);
      }
      setCapabilityAction(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Artifact action failed.";
      sendCapabilityResult(capabilityAction, false, message);
      setCapabilityStatus({
        kind: "error",
        message
      });
    }
  };

  useEffect(() => {
    if (!capabilityAction) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      cancelCapabilityAction();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [capabilityAction, cancelCapabilityAction]);

  return (
    <>
      <iframe
        key={frameDocument.epoch}
        ref={frameRef}
        className="preview-frame"
        title="ChatHTML artifact preview"
        sandbox={PREVIEW_IFRAME_SANDBOX}
        srcDoc={frameDocument.source}
        onLoad={() => {
          lastAppliedBodyHtmlRef.current = "";
          lastAppliedThemeModeRef.current = null;
          applySnapshotToFrame();
          postSelectionState();
        }}
        style={{ height }}
      />
      <ArtifactCapabilityPanel
        action={capabilityAction}
        status={capabilityStatus}
        onCancel={cancelCapabilityAction}
        onConfirm={() => void runCapabilityAction()}
      />
    </>
  );
}
