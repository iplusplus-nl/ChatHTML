import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Attachment } from "@assistant-ui/react";
import { getComposerAttachmentPresentation } from "./chatInputAttachmentModel";

describe("chat input attachment model", () => {
  it("keeps removal available while an upload is stalled", () => {
    const presentation = getComposerAttachmentPresentation({
      type: "running",
      reason: "uploading",
      progress: 0
    } as Attachment["status"]);

    assert.deepEqual(presentation, {
      isUploading: true,
      isError: false,
      isRemoveDisabled: false
    });
  });

  it("marks failed attachments without disabling removal", () => {
    const presentation = getComposerAttachmentPresentation({
      type: "incomplete",
      reason: "error"
    } as Attachment["status"]);

    assert.deepEqual(presentation, {
      isUploading: false,
      isError: true,
      isRemoveDisabled: false
    });
  });
});
