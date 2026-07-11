import type { ArtifactEdit, ClientMessage } from "./sessionTypes";

function legacyGeneratedArtifactSource(
  message: ClientMessage,
  edit: ArtifactEdit
): string | undefined {
  if (edit.parentId) {
    const parent = message.artifactEdits?.find(
      (candidate) => candidate.id === edit.parentId
    );
    const variant = parent?.variants.find(
      (candidate) => candidate.id === parent.activeVariantId
    ) ?? parent?.variants[0];
    if (parent?.status === "complete" && variant?.status === "complete") {
      return variant.rawStream;
    }
  }

  return message.artifactEditBaseRawStream;
}

export function migrateLegacyGeneratedArtifactBatch(
  message: ClientMessage
): ClientMessage {
  if (
    message.role !== "assistant" ||
    !message.generationRunId ||
    !message.activeArtifactEditId ||
    !message.artifactEdits?.length
  ) {
    return message;
  }

  const editIndex = message.artifactEdits.findIndex(
    (edit) => edit.id === message.activeArtifactEditId
  );
  const edit = message.artifactEdits[editIndex];
  if (
    !edit ||
    edit.origin ||
    edit.status !== "pending" ||
    edit.promptBubble !== false ||
    edit.references.length > 0
  ) {
    return message;
  }
  const variantIndex = edit.variants.findIndex(
    (variant) =>
      variant.id === edit.activeVariantId && variant.status === "pending"
  );
  const variant = edit.variants[variantIndex];
  if (!variant || variant.operationId) {
    return message;
  }

  const source = legacyGeneratedArtifactSource(message, edit);
  const isCancelled = (value: string | undefined) =>
    value?.replace(/\s+/g, " ").trim() === "Generation stopped.";
  // The legacy schema had no origin marker. For terminal messages, migrate only
  // when persisted output differs from its source or carries a cancel marker so
  // an abandoned local artifact edit is not misclassified as a chat run.
  const looksLikeChatRun =
    message.status === "streaming" ||
    isCancelled(message.content) ||
    isCancelled(message.error) ||
    message.rawStream !== source;
  if (!looksLikeChatRun) {
    return message;
  }

  const operationId = [
    "legacy-chat-run",
    message.generationRunId,
    edit.id,
    variant.id,
    String(variant.createdAt)
  ]
    .join(":")
    .slice(0, 160);
  const variants = [...edit.variants];
  variants[variantIndex] = { ...variant, operationId };
  const edits = [...message.artifactEdits];
  edits[editIndex] = {
    ...edit,
    origin: "chat-run",
    variants,
    rollback: edit.rollback ?? {}
  };

  return { ...message, artifactEdits: edits };
}
