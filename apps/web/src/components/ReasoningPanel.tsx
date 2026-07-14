import { stripSyntheticReasoningStatus } from "../core/reasoningText";

type ReasoningPanelProps = {
  messageId: string;
  reasoning?: string;
  isStreaming: boolean;
  isActive?: boolean;
  onOpenActivity?(messageId: string): void;
};

export function ReasoningPanel({
  messageId,
  reasoning = "",
  isStreaming,
  isActive = false,
  onOpenActivity
}: ReasoningPanelProps) {
  const visibleReasoning = stripSyntheticReasoningStatus(reasoning);
  const hasReasoning = visibleReasoning.trim().length > 0;
  const showStatusOnly = isStreaming && !hasReasoning;
  const canOpenActivity = hasReasoning || isStreaming;

  if (!hasReasoning && !showStatusOnly) {
    return null;
  }

  const label = getReasoningPanelLabel(isStreaming);

  return (
    <div
      className={`reasoning-panel ${isStreaming ? "is-streaming" : "is-complete"} ${
        showStatusOnly ? "is-status-only" : ""
      } ${isActive ? "is-active" : ""}`}
    >
      <button
        className="reasoning-trigger"
        type="button"
        aria-expanded={isActive}
        aria-label={canOpenActivity ? `${label}. Open thinking details` : label}
        disabled={!canOpenActivity}
        onClick={() => onOpenActivity?.(messageId)}
      >
        <span className="reasoning-label">{label}</span>
        {!showStatusOnly ? (
          <span className="reasoning-chevron" aria-hidden="true" />
        ) : null}
      </button>
    </div>
  );
}

export function getReasoningPanelLabel(isStreaming: boolean): string {
  return isStreaming ? "Thinking" : "Thought";
}
