import {
  buildArtifactContext,
  type ArtifactContext
} from "../../core/artifactContext";
import { isIgnoredRuntimeError } from "../../core/ignoredRuntimeErrors";
import { shouldCompleteArtifactRender } from "../../features/artifacts/artifactRenderCompletionPolicy";
import { extractStreamUiParts } from "../../runtime/streamui/protocol";
import { createStreamingRenderer } from "../../runtime/streamui/streamingRenderer";
import type {
  RenderError,
  RenderSnapshot
} from "../../runtime/streamui/types";
import type { ClientMessage } from "./sessionTypes";

function renderErrorKey(error: Pick<RenderError, "kind" | "message">): string {
  return `${error.kind}:${error.message}`;
}

function normalizeRenderError(input: unknown): RenderError | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const error = input as Partial<RenderError>;
  const kind =
    error.kind === "html" ||
    error.kind === "runtime" ||
    error.kind === "security" ||
    error.kind === "console" ||
    error.kind === "readability"
      ? error.kind
      : null;
  if (!kind || typeof error.message !== "string" || !error.message.trim()) {
    return null;
  }

  return {
    kind,
    message: error.message,
    ...(typeof error.filename === "string" && error.filename.trim()
      ? { filename: error.filename.trim().slice(0, 500) }
      : {}),
    timestamp:
      typeof error.timestamp === "number" && Number.isFinite(error.timestamp)
        ? error.timestamp
        : Date.now()
  };
}

export function normalizeRenderErrors(
  input: unknown
): RenderError[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const seen = new Set<string>();
  const errors: RenderError[] = [];

  for (const item of input) {
    const error = normalizeRenderError(item);
    if (!error || isIgnoredRuntimeError(error)) {
      continue;
    }

    const key = renderErrorKey(error);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    errors.push(error);
  }

  return errors.length ? errors : undefined;
}

export function normalizeArtifactContext(
  input: unknown
): ArtifactContext | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const context = input as Partial<ArtifactContext>;
  if (
    typeof context.id !== "string" ||
    !context.id.trim() ||
    typeof context.sourceHash !== "string" ||
    !context.sourceHash.trim()
  ) {
    return undefined;
  }

  return {
    id: context.id,
    sourceHash: context.sourceHash,
    sourceChars:
      typeof context.sourceChars === "number" && Number.isFinite(context.sourceChars)
        ? Math.max(0, Math.round(context.sourceChars))
        : 0,
    textSummary:
      typeof context.textSummary === "string" ? context.textSummary : "",
    styleSummary:
      typeof context.styleSummary === "string" ? context.styleSummary : "",
    structureSummary:
      typeof context.structureSummary === "string"
        ? context.structureSummary
        : "",
    editableSummary:
      typeof context.editableSummary === "string"
        ? context.editableSummary
        : ""
  };
}

function mergeSnapshotRuntimeErrors(
  snapshot: RenderSnapshot,
  runtimeErrors: RenderError[] | undefined
): RenderSnapshot {
  if (!runtimeErrors?.length) {
    return snapshot;
  }

  const seen = new Set(snapshot.errors.map(renderErrorKey));
  const mergedErrors = [...snapshot.errors];

  for (const error of runtimeErrors) {
    const key = renderErrorKey(error);
    if (!seen.has(key)) {
      seen.add(key);
      mergedErrors.push(error);
    }
  }

  return {
    ...snapshot,
    errors: mergedErrors
  };
}

export function rebuildAssistantSnapshot(message: ClientMessage): ClientMessage {
  if (message.role !== "assistant" || !message.rawStream) {
    return message;
  }

  const parts = extractStreamUiParts(message.rawStream);
  if (!parts.hasStreamUi || !parts.streamui.trim()) {
    return {
      ...message,
      status: message.status === "streaming" ? "complete" : message.status
    };
  }

  const renderer = createStreamingRenderer();
  renderer.replace(parts.streamui);
  if (
    shouldCompleteArtifactRender({
      status: message.status,
      generationOutcome: message.generationOutcome,
      streamUiComplete: parts.streamUiComplete
    })
  ) {
    renderer.complete();
  }

  const snapshot = mergeSnapshotRuntimeErrors(
    renderer.getSnapshot(),
    message.runtimeErrors
  );

  const shouldCompletePartialStream =
    message.status === "streaming" && !message.generationRunId;

  return {
    ...message,
    snapshot,
    hasStreamUi: true,
    streamUiComplete: parts.streamUiComplete,
    artifactContext: message.artifactContext ?? buildArtifactContext(message.rawStream),
    status: shouldCompletePartialStream ? "complete" : message.status
  };
}
