import { MessagePrimitive } from "@assistant-ui/react";
import { Check, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SessionFile } from "../domain/chat/sessionModel";

type ChatMessageProps = {
  id: string;
  role: "user" | "assistant";
  files?: SessionFile[];
  onEdit?(id: string, content: string): void;
  children: ReactNode;
};

export function ChatMessage({
  id,
  role,
  files = [],
  onEdit,
  children
}: ChatMessageProps) {
  const text = typeof children === "string" ? children : "";
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const canEdit = role === "user" && Boolean(onEdit);
  const normalizedDraft = draft.trim();
  const canSave = normalizedDraft.length > 0 && normalizedDraft !== text.trim();

  useEffect(() => {
    if (!isEditing) {
      setDraft(text);
    }
  }, [isEditing, text]);

  const saveEdit = () => {
    if (!canSave || !onEdit) {
      return;
    }

    onEdit(id, normalizedDraft);
    setIsEditing(false);
  };

  return (
    <MessagePrimitive.Root className={`chat-row ${role}`}>
      <div className="avatar" aria-hidden="true">
        {role === "user" ? "U" : "S"}
      </div>
      <div className="user-message-shell">
        <div className={`message-bubble ${role} ${isEditing ? "is-editing" : ""}`}>
          {isEditing ? (
            <>
              <textarea
                className="message-edit-input"
                value={draft}
                rows={Math.max(2, Math.min(8, draft.split(/\r?\n/).length + 1))}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="message-edit-actions">
                <button
                  className="message-action-button"
                  type="button"
                  title="Cancel edit"
                  aria-label="Cancel edit"
                  onClick={() => {
                    setDraft(text);
                    setIsEditing(false);
                  }}
                >
                  <X size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  className="message-action-button"
                  type="button"
                  title="Save edit"
                  aria-label="Save edit"
                  disabled={!canSave}
                  onClick={saveEdit}
                >
                  <Check size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <>
              {children ? <p>{children}</p> : null}
              {files.length > 0 ? (
                <div className="message-attachments" aria-label="Attached files">
                  {files.map((file) =>
                    file.kind === "image" && (file.embedUrl || file.dataUrl) ? (
                      <img
                        key={file.id}
                        src={file.embedUrl || file.dataUrl}
                        alt={file.name}
                        loading="lazy"
                      />
                    ) : (
                      <span className="message-file-chip" key={file.id}>
                        {file.name}
                      </span>
                    )
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
        {canEdit && !isEditing ? (
          <button
            className="message-action-button user-edit-button"
            type="button"
            title="Edit message"
            aria-label="Edit message"
            onClick={() => setIsEditing(true)}
          >
            <Pencil size={14} strokeWidth={2.15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}
