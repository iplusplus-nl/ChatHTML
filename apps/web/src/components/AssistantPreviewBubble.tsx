import { useRef, type ReactNode } from "react";
import type {
  PageThemeMode,
  RenderError,
  RenderSnapshot,
  StreamUiAction
} from "../core/types";
import { ArtifactExportMenu } from "./ArtifactExportMenu";
import { ErrorPanel } from "./ErrorPanel";
import { PreviewFrame } from "./PreviewFrame";

type AssistantPreviewBubbleProps = {
  id: string;
  snapshot: RenderSnapshot;
  themeMode: PageThemeMode;
  actions?: ReactNode;
  onRuntimeError(id: string, error: RenderError): void;
  onArtifactAction(id: string, action: StreamUiAction): void;
};

export function AssistantPreviewBubble({
  id,
  snapshot,
  themeMode,
  actions,
  onRuntimeError,
  onArtifactAction
}: AssistantPreviewBubbleProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const getExportWidth = () => containerRef.current?.clientWidth ?? 900;

  return (
    <div className="assistant-artifact-block">
      <section
        ref={containerRef}
        className={`assistant-canvas ${snapshot.status}`}
      >
        <PreviewFrame
          snapshot={snapshot}
          themeMode={themeMode}
          onRuntimeError={(error) => onRuntimeError(id, error)}
          onArtifactAction={(action) => onArtifactAction(id, action)}
        />
        <ErrorPanel errors={snapshot.errors} />
      </section>
      <div className="assistant-artifact-actions" aria-label="Artifact actions">
        {actions}
        <ArtifactExportMenu
          filenameBase={id}
          getExportWidth={getExportWidth}
          snapshot={snapshot}
          themeMode={themeMode}
        />
      </div>
    </div>
  );
}
