import { CheckCircle2, LoaderCircle, X } from "lucide-react";
import { stripSyntheticReasoningStatus } from "../../../core/reasoningText";
import type { ClientMessage } from "../../../domain/chat/sessionModel";

export type ThinkingActivityPanelModel = {
  reasoning: string;
  isStreaming: boolean;
  headerStatus: "Thinking" | "Complete";
  stepTitle: "Thinking" | "Thought";
  stepStatus: "In progress" | "Complete";
};

export function getThinkingActivityPanelModel(
  message: Pick<ClientMessage, "reasoning" | "status">
): ThinkingActivityPanelModel {
  const isStreaming = message.status === "streaming";

  return {
    reasoning: stripSyntheticReasoningStatus(message.reasoning ?? "").trim(),
    isStreaming,
    headerStatus: isStreaming ? "Thinking" : "Complete",
    stepTitle: isStreaming ? "Thinking" : "Thought",
    stepStatus: isStreaming ? "In progress" : "Complete"
  };
}

export function ThinkingActivityPanel({
  message,
  isClosing,
  onClose
}: {
  message: ClientMessage;
  isClosing?: boolean;
  onClose(): void;
}) {
  const model = getThinkingActivityPanelModel(message);

  return (
    <aside
      className={`thinking-activity-panel ${isClosing ? "is-closing" : ""}`}
      aria-labelledby="thinking-activity-title"
    >
      <header className="thinking-activity-header">
        <h2 id="thinking-activity-title">Activity</h2>
        <span className="thinking-activity-header-status">
          {model.headerStatus}
        </span>
        <button
          className="thinking-activity-close"
          type="button"
          aria-label="Close activity"
          onClick={onClose}
        >
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>
      <div className="thinking-activity-body">
        <section className="thinking-activity-section">
          <h3>Thinking</h3>
          <div className="thinking-activity-step">
            {model.isStreaming ? (
              <LoaderCircle size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
            )}
            <div>
              <strong>{model.stepTitle}</strong>
              <span>{model.stepStatus}</span>
            </div>
          </div>
          {model.reasoning ? (
            <pre className="thinking-activity-text">{model.reasoning}</pre>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
