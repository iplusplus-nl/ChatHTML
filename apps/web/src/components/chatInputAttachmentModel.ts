import type { Attachment } from "@assistant-ui/react";

export type ComposerAttachmentPresentation = {
  isUploading: boolean;
  isError: boolean;
  isRemoveDisabled: boolean;
};

export function getComposerAttachmentPresentation(
  status: Attachment["status"]
): ComposerAttachmentPresentation {
  return {
    isUploading: status.type === "running",
    isError: status.type === "incomplete",
    isRemoveDisabled: false
  };
}
