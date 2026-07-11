import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_API_SETTINGS,
  normalizeApiSettings
} from "../../core/apiSettings";
import type { ImageAttachment } from "../../core/imageAttachments";
import type { ChatSession } from "../../domain/chat/sessionModel";
import {
  createFreshChatRunMessagePlan,
  resolveFreshChatRunSettings
} from "./freshChatRunPlan";

function session(patch: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "Session",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    files: [],
    ...patch
  };
}

function uploadedAttachment(
  patch: Partial<ImageAttachment> = {}
): ImageAttachment {
  return {
    id: "attachment-1",
    name: "image.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AA==",
    size: 1,
    ownerSessionId: "session-1",
    sessionFile: {
      id: "file-1",
      kind: "image",
      name: "image.png",
      mimeType: "image/png",
      size: 1,
      createdAt: 1,
      storageKey: "storage-1",
      contentHash: "hash-1",
      accessToken: "token-1",
      embedUrl: "/api/files/file-1",
      downloadUrl: "/api/files/file-1/download",
      draft: true
    },
    ...patch
  };
}

describe("fresh chat run plan", () => {
  it("resolves per-session generation settings over global defaults", () => {
    const result = resolveFreshChatRunSettings({
      session: session({
        model: "session-model",
        reasoningEffort: "high",
        uiComplexity: 88
      }),
      sessionId: "session-1",
      attachments: [],
      apiSettings: normalizeApiSettings({
        ...DEFAULT_API_SETTINGS,
        model: "global-model",
        reasoningEffort: "low",
        uiComplexity: 30
      }),
      runtimeSettings: null
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requestModel, "session-model");
    assert.equal(result.requestReasoningEffort, "high");
    assert.equal(result.requestUiComplexity, 88);
    assert.equal(result.requestApiSettings.model, "session-model");
  });

  it("rejects attachments owned by another session before planning", () => {
    const result = resolveFreshChatRunSettings({
      session: session(),
      sessionId: "session-1",
      attachments: [uploadedAttachment({ ownerSessionId: "session-2" })],
      apiSettings: DEFAULT_API_SETTINGS,
      runtimeSettings: null
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.warning, /another session/i);
  });

  it("builds stable user and assistant messages from injected ids", () => {
    const ids = ["user-1", "assistant-1", "run-1"];
    const result = createFreshChatRunMessagePlan({
      text: "  hello  ",
      attachments: [],
      options: {
        initialReasoning: "Thinking",
        branchRunRollback: {
          ...({ runId: "forged-run" } as Record<string, string>),
          groupId: "group-1",
          variantId: "variant-2",
          fallbackVariantId: "variant-1"
        }
      },
      session: session({
        messages: [
          { id: "prior", role: "user", content: "prior", status: "complete" }
        ]
      }),
      createId: () => ids.shift() ?? "unexpected"
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.userMessage.id, "user-1");
    assert.equal(result.userMessage.content, "hello");
    assert.equal(result.assistantId, "assistant-1");
    assert.equal(result.generationRunId, "run-1");
    assert.equal(result.assistantMessage.reasoning, "Thinking");
    assert.deepEqual(result.assistantMessage.branchRunRollback, {
      runId: "run-1",
      groupId: "group-1",
      variantId: "variant-2",
      fallbackVariantId: "variant-1"
    });
    assert.equal(result.previousMessages.length, 1);
  });

  it("preserves supplied ids and user patches", () => {
    let generated = 0;
    const result = createFreshChatRunMessagePlan({
      text: "hello",
      attachments: [],
      options: {
        appendUserMessage: false,
        assistantMessageId: "existing-assistant",
        generationRunId: "existing-run",
        userMessagePatch: {
          branchGroupId: "group-1",
          branchVariantId: "variant-1",
          fileIds: ["existing-file"]
        }
      },
      session: session(),
      createId: () => `generated-${++generated}`
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.appendUserMessage, false);
    assert.equal(result.userMessage.id, "generated-1");
    assert.deepEqual(result.userMessage.fileIds, ["existing-file"]);
    assert.equal(result.assistantId, "existing-assistant");
    assert.equal(result.generationRunId, "existing-run");
    assert.equal(generated, 1);
  });

  it("uses committed attachment files and honors ephemeral ownership", () => {
    const result = createFreshChatRunMessagePlan({
      text: "image",
      attachments: [uploadedAttachment()],
      options: { ephemeralAttachments: true },
      session: session(),
      createId: (prefix) => `${prefix}-1`
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.userMessage.fileIds, ["file-1"]);
    assert.equal(result.preparedAttachmentFiles.ephemeral, true);
    assert.equal(result.preparedAttachmentFiles.uploadedFiles.length, 1);
  });

  it("rejects attachments that are not durably committed", () => {
    const result = createFreshChatRunMessagePlan({
      text: "image",
      attachments: [uploadedAttachment({ sessionFile: undefined })],
      options: {},
      session: session(),
      createId: (prefix) => `${prefix}-1`
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.warning, /upload is still in progress/i);
  });
});
