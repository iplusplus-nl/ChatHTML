import { MessagePrimitive } from "@assistant-ui/react";
import { useMemo } from "react";
import { extractStreamUiParts } from "../runtime/streamui/protocol";
import { createStreamingRenderer } from "../runtime/streamui/streamingRenderer";
import type {
  PageThemeMode,
  RenderError,
  RenderSnapshot
} from "../runtime/streamui/types";
import { AssistantPreviewBubble } from "./AssistantPreviewBubble";
import { AssistantTextBubble } from "./AssistantTextBubble";
import { RawStreamPanel } from "./RawStreamPanel";
import { ReasoningPanel } from "./ReasoningPanel";

type AssistantMessageProps = {
  id: string;
  content: string;
  reasoning?: string;
  rawStream?: string;
  hasStreamUi?: boolean;
  snapshot?: RenderSnapshot;
  runtimeErrors?: RenderError[];
  themeMode: PageThemeMode;
  status?: "streaming" | "complete" | "error";
  error?: string;
  onRuntimeError(id: string, error: RenderError): void;
};

export function AssistantMessage({
  id,
  content,
  reasoning,
  rawStream,
  hasStreamUi,
  snapshot,
  runtimeErrors,
  themeMode,
  status,
  error,
  onRuntimeError
}: AssistantMessageProps) {
  const resolvedSnapshot = useMemo(() => {
    const withRuntimeErrors = (
      candidate: RenderSnapshot | undefined
    ): RenderSnapshot | undefined => {
      if (!candidate || !runtimeErrors?.length) {
        return candidate;
      }

      const existing = new Set(
        candidate.errors.map((item) => `${item.kind}:${item.message}`)
      );
      const mergedErrors = [...candidate.errors];

      for (const error of runtimeErrors) {
        const key = `${error.kind}:${error.message}`;
        if (!existing.has(key)) {
          existing.add(key);
          mergedErrors.push(error);
        }
      }

      return {
        ...candidate,
        errors: mergedErrors
      };
    };

    if (!hasStreamUi || !rawStream) {
      return withRuntimeErrors(snapshot);
    }

    const parts = extractStreamUiParts(rawStream);
    if (!parts.hasStreamUi || !parts.streamui.trim()) {
      return snapshot;
    }

    const renderer = createStreamingRenderer(themeMode);
    renderer.replace(parts.streamui);
    if (status === "complete" || parts.streamUiComplete) {
      renderer.complete();
    }
    return withRuntimeErrors(renderer.getSnapshot());
  }, [hasStreamUi, rawStream, runtimeErrors, snapshot, status, themeMode]);

  return (
    <MessagePrimitive.Root className="chat-row assistant">
      <div className="avatar" aria-hidden="true">
        S
      </div>
      <div className="assistant-stack">
        <ReasoningPanel
          reasoning={reasoning}
          isStreaming={status === "streaming"}
        />
        <AssistantTextBubble
          content={content}
          error={error}
        />
        {hasStreamUi && resolvedSnapshot ? (
          <AssistantPreviewBubble
            id={id}
            snapshot={resolvedSnapshot}
            themeMode={themeMode}
            onRuntimeError={onRuntimeError}
          />
        ) : null}
        <RawStreamPanel raw={rawStream} />
      </div>
    </MessagePrimitive.Root>
  );
}
