import type { ImageAttachment } from "../../core/imageAttachments";
import type { ClientMessage, SessionFile } from "./sessionTypes";

function normalizeSessionFile(
  input: unknown,
  now = Date.now()
): SessionFile | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const file = input as Partial<SessionFile>;
  const kind =
    file.kind === "image" || file.kind === "artifact" || file.kind === "text"
      ? file.kind
      : null;
  if (
    !kind ||
    typeof file.id !== "string" ||
    !file.id.trim() ||
    typeof file.name !== "string" ||
    !file.name.trim()
  ) {
    return null;
  }

  const dataUrl = typeof file.dataUrl === "string" ? file.dataUrl : undefined;
  const text = typeof file.text === "string" ? file.text : undefined;
  const storageKey =
    typeof file.storageKey === "string" && file.storageKey.trim()
      ? file.storageKey.trim()
      : undefined;
  if (kind === "image" && !dataUrl && !storageKey) {
    return null;
  }
  if ((kind === "artifact" || kind === "text") && !text && !storageKey) {
    return null;
  }

  return {
    id: file.id.trim(),
    kind,
    name: file.name.trim().slice(0, 180),
    mimeType:
      typeof file.mimeType === "string" && file.mimeType.trim()
        ? file.mimeType.trim().slice(0, 120)
        : kind === "image"
          ? "image/png"
          : "text/plain",
    size:
      typeof file.size === "number" && Number.isFinite(file.size)
        ? Math.max(0, Math.round(file.size))
        : text?.length ?? 0,
    createdAt:
      typeof file.createdAt === "number" && Number.isFinite(file.createdAt)
        ? file.createdAt
        : now,
    sourceMessageId:
      typeof file.sourceMessageId === "string" && file.sourceMessageId.trim()
        ? file.sourceMessageId.trim()
        : undefined,
    storageKey,
    contentHash:
      typeof file.contentHash === "string" && file.contentHash.trim()
        ? file.contentHash.trim()
        : undefined,
    accessToken:
      typeof file.accessToken === "string" && file.accessToken.trim()
        ? file.accessToken.trim()
        : undefined,
    embedUrl:
      typeof file.embedUrl === "string" && file.embedUrl.trim()
        ? file.embedUrl.trim()
        : undefined,
    downloadUrl:
      typeof file.downloadUrl === "string" && file.downloadUrl.trim()
        ? file.downloadUrl.trim()
        : undefined,
    dataUrl,
    text,
    width:
      typeof file.width === "number" && Number.isFinite(file.width)
        ? Math.max(1, Math.round(file.width))
        : undefined,
    height:
      typeof file.height === "number" && Number.isFinite(file.height)
        ? Math.max(1, Math.round(file.height))
        : undefined,
    summary:
      typeof file.summary === "string" ? file.summary.slice(0, 1_200) : undefined
  };
}

export function normalizeSessionFiles(
  input: unknown,
  now = Date.now()
): SessionFile[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const files: SessionFile[] = [];
  for (const item of input) {
    const file = normalizeSessionFile(item, now);
    if (!file || seen.has(file.id)) {
      continue;
    }
    seen.add(file.id);
    files.push(file);
  }

  return files;
}

function legacyAttachmentToSessionFile(
  attachment: ImageAttachment,
  messageId: string,
  now = Date.now()
): SessionFile | null {
  if (!attachment.dataUrl || !attachment.name || !attachment.id) {
    return null;
  }

  return normalizeSessionFile(
    {
      id: `file-${attachment.id}`,
      kind: "image",
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: now,
      sourceMessageId: messageId,
      dataUrl: attachment.dataUrl,
      width: attachment.width,
      height: attachment.height,
      summary: `Uploaded image ${attachment.name}`
    },
    now
  );
}

function assistantArtifactToSessionFile(
  message: ClientMessage,
  now = Date.now()
): SessionFile | null {
  if (
    message.role !== "assistant" ||
    !message.rawStream ||
    (!message.hasStreamUi && !/<streamui\b/i.test(message.rawStream))
  ) {
    return null;
  }

  const context = message.artifactContext;
  return normalizeSessionFile(
    {
      id: `file-artifact-${message.id}`,
      kind: "artifact",
      name: `${message.id}.chathtml.html`,
      mimeType: "text/html",
      size: message.rawStream.length,
      createdAt: now,
      sourceMessageId: message.id,
      text: message.rawStream,
      summary: context?.textSummary || "ChatHTML artifact raw source"
    },
    now
  );
}

export function migrateMessageFiles(
  messages: ClientMessage[],
  files: SessionFile[],
  now = Date.now()
): { messages: ClientMessage[]; files: SessionFile[] } {
  const fileMap = new Map(files.map((file) => [file.id, file]));

  const migratedMessages = messages.map((message) => {
    const fileIds = new Set(message.fileIds ?? []);

    if (message.attachments?.length) {
      for (const attachment of message.attachments) {
        const file = legacyAttachmentToSessionFile(attachment, message.id, now);
        if (!file) {
          continue;
        }
        fileMap.set(file.id, file);
        fileIds.add(file.id);
      }
    }

    const artifactFile = assistantArtifactToSessionFile(message, now);
    if (artifactFile) {
      fileMap.set(artifactFile.id, artifactFile);
    }

    const { attachments: _attachments, ...rest } = message;
    return {
      ...rest,
      fileIds: fileIds.size ? Array.from(fileIds) : undefined
    };
  });

  return {
    messages: migratedMessages,
    files: Array.from(fileMap.values()).sort((a, b) => a.createdAt - b.createdAt)
  };
}
