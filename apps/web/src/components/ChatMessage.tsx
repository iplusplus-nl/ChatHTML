import { MessagePrimitive } from "@assistant-ui/react";
import { Check, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  ArtifactEdit,
  ArtifactEditReference,
  SessionFile
} from "../domain/chat/sessionModel";

type ArtifactEditTimeline = {
  assistantId: string;
  edits: ArtifactEdit[];
  activeEditId?: string;
  disabled?: boolean;
};

type ChatMessageProps = {
  id: string;
  role: "user" | "assistant";
  files?: SessionFile[];
  artifactEditTimeline?: ArtifactEditTimeline;
  onEdit?(id: string, content: string): void;
  onSelectArtifactEdit?(assistantId: string, editId?: string): void;
  onDiscardArtifactEditTail?(assistantId: string, editId?: string): boolean;
  onEditArtifactEditPrompt?(
    assistantId: string,
    editId: string,
    prompt: string
  ): boolean;
  children: ReactNode;
};

function hasUsableArtifactEditVariant(edit: ArtifactEdit): boolean {
  if (edit.status !== "complete") {
    return false;
  }

  const activeVariant = getArtifactEditActiveVariant(edit);
  return activeVariant?.status === "complete" && Boolean(activeVariant.rawStream);
}

function getActiveArtifactVersionIndex(
  timeline: ArtifactEditTimeline,
  edits: ArtifactEdit[]
): number {
  if (!timeline.activeEditId) {
    return 0;
  }

  const index = edits.findIndex((edit) => edit.id === timeline.activeEditId);
  return index >= 0 ? index + 1 : -1;
}

function getArtifactEditActiveVariant(edit: ArtifactEdit) {
  return (
    edit.variants.find((variant) => variant.id === edit.activeVariantId) ??
    edit.variants[0]
  );
}

function getArtifactEditErrorText(edit: ArtifactEdit): string {
  return (
    edit.error ||
    getArtifactEditActiveVariant(edit)?.error ||
    edit.variants.find((variant) => Boolean(variant.error))?.error ||
    "The artifact edit did not complete."
  );
}

function getArtifactReferenceText(reference: ArtifactEditReference): string {
  return reference.preview || reference.label;
}

function ArtifactEditReferenceChip({
  references
}: {
  references: ArtifactEditReference[];
}) {
  const reference = references[0];
  if (!reference) {
    return null;
  }

  return (
    <span className={`artifact-edit-reference-chip is-${reference.kind}`}>
      <span className="artifact-selection-kind">
        {reference.kind === "text" ? "Reference" : "Element"}
      </span>
      <span className="artifact-edit-reference-text">
        {getArtifactReferenceText(reference)}
      </span>
      {references.length > 1 ? (
        <span className="artifact-edit-reference-more">
          +{references.length - 1}
        </span>
      ) : null}
    </span>
  );
}

function ArtifactEditPromptConfirmDialog({
  discardCount,
  onCancel,
  onConfirm
}: {
  discardCount: number;
  onCancel(): void;
  onConfirm(): void;
}) {
  const changeLabel = discardCount === 1 ? "change" : "changes";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return (
    <div
      className="artifact-tail-discard-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artifact-edit-prompt-confirm-title"
    >
      <div className="artifact-tail-discard-dialog">
        <div className="artifact-tail-discard-copy">
          <h2 id="artifact-edit-prompt-confirm-title">Edit this prompt?</h2>
          <p>
            Editing this prompt will discard {discardCount} later {changeLabel}.
            The reference stays the same.
          </p>
        </div>
        <div className="artifact-tail-discard-actions">
          <button
            className="artifact-tail-discard-secondary"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="artifact-tail-discard-primary"
            type="button"
            autoFocus
            onClick={onConfirm}
          >
            Discard and edit
          </button>
        </div>
      </div>
    </div>
  );
}

function ArtifactEditTimelineView({
  timeline,
  onSelectArtifactEdit,
  onDiscardArtifactEditTail,
  onEditArtifactEditPrompt
}: {
  timeline: ArtifactEditTimeline;
  onSelectArtifactEdit?(assistantId: string, editId?: string): void;
  onDiscardArtifactEditTail?(assistantId: string, editId?: string): boolean;
  onEditArtifactEditPrompt?(
    assistantId: string,
    editId: string,
    prompt: string
  ): boolean;
}) {
  const [editingEditId, setEditingEditId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [confirmPromptEdit, setConfirmPromptEdit] = useState<{
    editId: string;
    prompt: string;
    discardCount: number;
  } | null>(null);
  const usableEdits = timeline.edits.filter(hasUsableArtifactEditVariant);
  const pendingEdits = timeline.edits.filter((edit) => edit.status === "pending");
  const failedEdits = timeline.edits.filter(
    (edit) => edit.status === "error" && !hasUsableArtifactEditVariant(edit)
  );
  const closePromptEditor = () => {
    setEditingEditId(null);
    setDraftPrompt("");
  };

  useEffect(() => {
    if (!editingEditId) {
      return;
    }

    if (!usableEdits.some((edit) => edit.id === editingEditId)) {
      closePromptEditor();
    }
  }, [editingEditId, usableEdits]);

  if (!usableEdits.length && !pendingEdits.length && !failedEdits.length) {
    return null;
  }

  const activeVersionIndex = getActiveArtifactVersionIndex(timeline, usableEdits);
  const openPromptEditor = (edit: ArtifactEdit) => {
    setEditingEditId(edit.id);
    setDraftPrompt(edit.prompt);
  };

  const requestPromptEdit = (edit: ArtifactEdit, index: number) => {
    if (timeline.disabled || !onEditArtifactEditPrompt) {
      return;
    }

    const discardCount = usableEdits.length - index - 1;
    if (discardCount > 0) {
      setConfirmPromptEdit({
        editId: edit.id,
        prompt: edit.prompt,
        discardCount
      });
      return;
    }

    openPromptEditor(edit);
  };

  const confirmMiddlePromptEdit = () => {
    const intent = confirmPromptEdit;
    if (!intent) {
      return;
    }

    setConfirmPromptEdit(null);
    const didDiscard = onDiscardArtifactEditTail?.(
      timeline.assistantId,
      intent.editId
    );
    if (didDiscard) {
      setEditingEditId(intent.editId);
      setDraftPrompt(intent.prompt);
    }
  };

  const savePromptEdit = (edit: ArtifactEdit) => {
    const normalized = draftPrompt.trim();
    if (!normalized) {
      return;
    }

    if (normalized === edit.prompt.trim()) {
      closePromptEditor();
      return;
    }

    const didStart = onEditArtifactEditPrompt?.(
      timeline.assistantId,
      edit.id,
      normalized
    );
    if (didStart) {
      closePromptEditor();
    }
  };

  return (
    <div className="artifact-edit-linear-list" aria-label="Artifact edits">
      {usableEdits.map((edit, index) => {
        const activeVariant = getArtifactEditActiveVariant(edit);
        const canSelect =
          edit.status === "complete" &&
            activeVariant?.status === "complete" &&
            Boolean(activeVariant.rawStream) &&
            !timeline.disabled &&
            Boolean(onSelectArtifactEdit);
        const canEditPrompt =
          edit.status === "complete" &&
          activeVariant?.status === "complete" &&
          Boolean(activeVariant.rawStream) &&
          !timeline.disabled &&
          Boolean(onEditArtifactEditPrompt);
        const isActive = activeVersionIndex === index + 1;

        if (editingEditId === edit.id) {
          const normalizedDraft = draftPrompt.trim();
          const canSave =
            normalizedDraft.length > 0 &&
            normalizedDraft !== edit.prompt.trim();

          return (
            <div
              className={`message-bubble user artifact-edit-bubble is-editing ${
                isActive ? "is-artifact-edit-active" : ""
              }`}
              key={edit.id}
            >
              <ArtifactEditReferenceChip references={edit.references} />
              <textarea
                className="artifact-edit-prompt-input"
                value={draftPrompt}
                rows={Math.max(
                  1,
                  Math.min(5, draftPrompt.split(/\r?\n/).length + 1)
                )}
                autoFocus
                onChange={(event) => setDraftPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    closePromptEditor();
                  }
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    savePromptEdit(edit);
                  }
                }}
              />
              <div className="message-edit-actions artifact-edit-prompt-actions">
                <button
                  className="message-action-button"
                  type="button"
                  title="Cancel edit"
                  aria-label="Cancel edit"
                  onClick={closePromptEditor}
                >
                  <X size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  className="message-action-button"
                  type="button"
                  title="Save edit"
                  aria-label="Save edit"
                  disabled={!canSave}
                  onClick={() => savePromptEdit(edit)}
                >
                  <Check size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        }

        return (
          <div
            className="bubble-action-shell artifact-edit-action-shell"
            key={edit.id}
          >
            <button
              className={`message-bubble user artifact-edit-bubble is-${edit.status} ${
                isActive ? "is-artifact-edit-active" : ""
              }`}
              type="button"
              disabled={!canSelect}
              title="Show edit"
              aria-label="Show edit"
              onClick={() => onSelectArtifactEdit?.(timeline.assistantId, edit.id)}
            >
              <ArtifactEditReferenceChip references={edit.references} />
              <p>{edit.prompt}</p>
            </button>
            {canEditPrompt ? (
              <button
                className="message-action-button bubble-edit-button"
                type="button"
                title="Edit prompt"
                aria-label="Edit prompt"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  requestPromptEdit(edit, index);
                }}
              >
                <Pencil size={14} strokeWidth={2.15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
      {pendingEdits.map((edit) => (
        <button
          className={`message-bubble user artifact-edit-bubble is-pending is-artifact-edit-pending ${
            timeline.activeEditId === edit.id ? "is-artifact-edit-active" : ""
          }`}
          key={edit.id}
          type="button"
          disabled
          role="status"
        >
          <ArtifactEditReferenceChip references={edit.references} />
          <p>{edit.prompt}</p>
          <span
            className="artifact-edit-loading-spinner"
            aria-label="Editing"
          />
        </button>
      ))}
      {failedEdits.map((edit) => (
        <div className="artifact-edit-failed-item" key={edit.id}>
          <div
            className="message-bubble user artifact-edit-bubble is-error"
            role="status"
          >
            <ArtifactEditReferenceChip references={edit.references} />
            <p>{edit.prompt}</p>
          </div>
          <div className="artifact-edit-status-row is-error">
            <span className="artifact-edit-error-message">
              {getArtifactEditErrorText(edit)}
            </span>
            <button
              className="artifact-edit-discard-button"
              type="button"
              disabled={timeline.disabled || !onDiscardArtifactEditTail}
              onClick={() =>
                onDiscardArtifactEditTail?.(timeline.assistantId, edit.id)
              }
            >
              <X size={13} strokeWidth={2.25} aria-hidden="true" />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      ))}
      {confirmPromptEdit ? (
        <ArtifactEditPromptConfirmDialog
          discardCount={confirmPromptEdit.discardCount}
          onCancel={() => setConfirmPromptEdit(null)}
          onConfirm={confirmMiddlePromptEdit}
        />
      ) : null}
    </div>
  );
}

export function ChatMessage({
  id,
  role,
  files = [],
  artifactEditTimeline,
  onEdit,
  onSelectArtifactEdit,
  onDiscardArtifactEditTail,
  onEditArtifactEditPrompt,
  children
}: ChatMessageProps) {
  const text = typeof children === "string" ? children : "";
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const canEdit = role === "user" && Boolean(onEdit);
  const normalizedDraft = draft.trim();
  const canSave = normalizedDraft.length > 0 && normalizedDraft !== text.trim();
  const canSelectOriginal =
    role === "user" &&
    !isEditing &&
    Boolean(artifactEditTimeline) &&
    Boolean(onSelectArtifactEdit);
  const canShowEditButton =
    canEdit && !isEditing && !artifactEditTimeline?.disabled;

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

  const messageContent = isEditing ? (
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
  );
  const bubbleClassName = `message-bubble ${role} ${
    isEditing ? "is-editing" : ""
  } ${canSelectOriginal ? "is-original-trigger" : ""} ${
    canSelectOriginal && !artifactEditTimeline?.activeEditId
      ? "is-original-active"
      : ""
  }`;

  return (
    <MessagePrimitive.Root className={`chat-row ${role}`}>
      <div className="avatar" aria-hidden="true">
        {role === "user" ? "U" : "S"}
      </div>
      <div className="user-message-shell">
        <div className="bubble-action-shell user-bubble-action-shell">
          {canSelectOriginal ? (
            <button
              className={bubbleClassName}
              type="button"
              title="Show original artifact"
              aria-label="Show original artifact"
              disabled={artifactEditTimeline?.disabled}
              onClick={() =>
                onSelectArtifactEdit?.(artifactEditTimeline?.assistantId ?? "")
              }
            >
              {messageContent}
            </button>
          ) : (
            <div className={bubbleClassName}>{messageContent}</div>
          )}
          {canShowEditButton ? (
            <button
              className="message-action-button bubble-edit-button user-edit-button"
              type="button"
              title="Edit prompt"
              aria-label="Edit prompt"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsEditing(true);
              }}
            >
              <Pencil size={14} strokeWidth={2.15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {artifactEditTimeline ? (
          <ArtifactEditTimelineView
            timeline={artifactEditTimeline}
            onSelectArtifactEdit={onSelectArtifactEdit}
            onDiscardArtifactEditTail={onDiscardArtifactEditTail}
            onEditArtifactEditPrompt={onEditArtifactEditPrompt}
          />
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}
