import type { ClientMessage } from "../../domain/chat/sessionModel";

export type CompleteArtifactEditVariantInput = {
  editId: string;
  variantId: string;
  rawStream: string;
  summary?: string;
  editCount?: number;
  baseRawStream: string;
};

export function completeArtifactEditVariant(
  message: ClientMessage,
  input: CompleteArtifactEditVariantInput
): ClientMessage {
  return {
    ...message,
    artifactEditBaseRawStream:
      message.artifactEditBaseRawStream ?? input.baseRawStream,
    artifactEdits: (message.artifactEdits ?? []).map((edit) =>
      edit.id === input.editId
        ? {
            ...edit,
            status: "complete",
            error: undefined,
            activeVariantId: input.variantId,
            variants: edit.variants.map((variant) =>
              variant.id === input.variantId
                ? {
                    ...variant,
                    status: "complete",
                    rawStream: input.rawStream,
                    summary: input.summary,
                    error: undefined,
                    editCount: input.editCount
                  }
                : variant
            )
          }
        : edit
    ),
    activeArtifactEditId: input.editId
  };
}

export function failArtifactEditVariant(
  message: ClientMessage,
  editId: string,
  variantId: string,
  errorMessage: string
): ClientMessage {
  return {
    ...message,
    artifactEdits: (message.artifactEdits ?? []).map((edit) =>
      edit.id === editId
        ? {
            ...edit,
            status: "error",
            error: errorMessage,
            variants: edit.variants.map((variant) =>
              variant.id === variantId
                ? {
                    ...variant,
                    status: "error",
                    error: errorMessage
                  }
                : variant
            )
          }
        : edit
    ),
    activeArtifactEditId: editId
  };
}

export function removeArtifactEdit(
  message: ClientMessage,
  editId: string,
  fallbackActiveEditId?: string
): ClientMessage {
  const artifactEdits = (message.artifactEdits ?? []).filter(
    (edit) => edit.id !== editId
  );

  return {
    ...message,
    artifactEditBaseRawStream: artifactEdits.length
      ? message.artifactEditBaseRawStream
      : undefined,
    artifactEdits: artifactEdits.length ? artifactEdits : undefined,
    activeArtifactEditId:
      message.activeArtifactEditId === editId
        ? fallbackActiveEditId
        : message.activeArtifactEditId
  };
}
