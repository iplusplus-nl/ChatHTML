import {
  normalizeApiSettings,
  normalizeUiComplexity,
  type ApiSettings,
  type ReasoningEffort
} from "../../core/apiSettings";
import type { ImageAttachment } from "../../core/imageAttachments";
import type { RuntimeSettingsSummary } from "../../core/runtimeSettings";
import type {
  ChatSession,
  ClientMessage
} from "../../domain/chat/sessionModel";
import { getVisibleSessionMessages } from "./branching";
import {
  prepareChatRunAttachmentFiles,
  type PreparedChatRunAttachmentFiles
} from "./chatRunAttachmentFiles";
import type { SendStreamUiRequestOptions } from "./chatRunRequest";
import { coerceApiSettingsForRuntime } from "../settings/appSettingsPolicy";
import { getAttachmentSessionError } from "../sessions/sessionFileModel";

export type FreshChatRunSettingsPlan = {
  requestModel: string;
  requestReasoningEffort: ReasoningEffort;
  requestUiComplexity: number;
  requestApiSettings: ApiSettings;
};

export type FreshChatRunMessagePlan = {
  appendUserMessage: boolean;
  assistantId: string;
  generationRunId: string;
  previousMessages: ClientMessage[];
  preparedAttachmentFiles: PreparedChatRunAttachmentFiles;
  userMessage: ClientMessage;
  assistantMessage: ClientMessage;
};

export type FreshChatRunPlanFailure = {
  ok: false;
  warning: string;
};

export type FreshChatRunSettingsResult =
  | FreshChatRunPlanFailure
  | ({ ok: true } & FreshChatRunSettingsPlan);

export type FreshChatRunMessageResult =
  | FreshChatRunPlanFailure
  | ({ ok: true } & FreshChatRunMessagePlan);

export function resolveFreshChatRunSettings(input: {
  session: ChatSession;
  sessionId: string;
  attachments: readonly ImageAttachment[];
  apiSettings: ApiSettings;
  runtimeSettings: RuntimeSettingsSummary | null;
}): FreshChatRunSettingsResult {
  const attachmentSessionError = getAttachmentSessionError(
    [...input.attachments],
    input.sessionId
  );
  if (attachmentSessionError) {
    return { ok: false, warning: attachmentSessionError };
  }

  const requestModel = (input.session.model || input.apiSettings.model).trim();
  const requestReasoningEffort =
    input.session.reasoningEffort ?? input.apiSettings.reasoningEffort;
  const requestUiComplexity = normalizeUiComplexity(
    input.session.uiComplexity ?? input.apiSettings.uiComplexity
  );
  const requestApiSettings = coerceApiSettingsForRuntime(
    normalizeApiSettings({
      ...input.apiSettings,
      model: requestModel,
      reasoningEffort: requestReasoningEffort,
      uiComplexity: requestUiComplexity
    }),
    input.runtimeSettings
  );

  return {
    ok: true,
    requestModel,
    requestReasoningEffort,
    requestUiComplexity,
    requestApiSettings
  };
}

export function createFreshChatRunMessagePlan(input: {
  text: string;
  attachments: readonly ImageAttachment[];
  options: SendStreamUiRequestOptions;
  session: ChatSession;
  createId(prefix: string): string;
}): FreshChatRunMessageResult {
  const appendUserMessage = input.options.appendUserMessage ?? true;
  const ephemeralAttachments = input.options.ephemeralAttachments ?? false;
  const userMessageId = input.createId("user");
  const previousMessages = getVisibleSessionMessages(input.session);
  const preparedAttachmentFiles = prepareChatRunAttachmentFiles(
    input.attachments,
    userMessageId,
    ephemeralAttachments
  );
  if (!preparedAttachmentFiles.allAttachmentsCommitted) {
    return {
      ok: false,
      warning: "Image upload is still in progress. Please wait before sending."
    };
  }

  const userMessage: ClientMessage = {
    ...input.options.userMessagePatch,
    id: userMessageId,
    role: "user",
    content: input.text.trim(),
    fileIds: preparedAttachmentFiles.uploadedFiles.length
      ? preparedAttachmentFiles.uploadedFiles.map((file) => file.id)
      : input.options.userMessagePatch?.fileIds,
    status: "complete"
  };
  const assistantId =
    input.options.assistantMessageId?.trim() || input.createId("assistant");
  const generationRunId =
    input.options.generationRunId?.trim() || input.createId("run");
  const assistantMessage: ClientMessage = {
    ...input.options.assistantPatch,
    id: assistantId,
    role: "assistant",
    content: "",
    rawStream: "",
    generationRunId,
    streamSequence: 0,
    generationOutcome: undefined,
    status: "streaming",
    ...(input.options.branchRunRollback
      ? {
          branchRunRollback: {
            ...input.options.branchRunRollback,
            runId: generationRunId
          }
        }
      : {}),
    ...(input.options.initialReasoning
      ? { reasoning: input.options.initialReasoning }
      : {})
  };

  return {
    ok: true,
    appendUserMessage,
    assistantId,
    generationRunId,
    previousMessages,
    preparedAttachmentFiles,
    userMessage,
    assistantMessage
  };
}
