import { stripInternalArtifactContextText } from "../features/chat/internalArtifactContext";

type AssistantTextBubbleProps = {
  content: string;
  error?: string;
  placeholder?: string;
};

export function AssistantTextBubble({
  content,
  error,
  placeholder
}: AssistantTextBubbleProps) {
  const visibleContent = stripInternalArtifactContextText(content);

  if (!visibleContent && !error && !placeholder) {
    return null;
  }

  return (
    <div
      className={`message-bubble assistant ${
        placeholder && !visibleContent && !error ? "is-placeholder" : ""
      }`}
    >
      {visibleContent ? <p>{visibleContent}</p> : null}
      {!visibleContent && !error && placeholder ? <p>{placeholder}</p> : null}
      {error ? <pre className="inline-error">{error}</pre> : null}
    </div>
  );
}
