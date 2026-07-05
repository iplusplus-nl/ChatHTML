import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment
} from "@assistant-ui/react";
import {
  MAX_IMAGE_ATTACHMENTS,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ImageAttachment,
  type UploadedSessionFile
} from "./imageAttachments";

const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 1.8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const QUALITY_COMPRESSIBLE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/webp"]);

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((base64.length * 3) / 4);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read the image file."));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener(
      "error",
      () => reject(new Error("Could not decode the image."))
    );
    image.src = dataUrl;
  });
}

function replaceFileExtension(name: string, mimeType: string): string {
  const extension =
    mimeType === "image/jpeg"
      ? ".jpg"
      : mimeType === "image/webp"
        ? ".webp"
        : mimeType === "image/png"
          ? ".png"
          : "";

  if (!extension) {
    return name;
  }

  return /\.[^.]+$/.test(name)
    ? name.replace(/\.[^.]+$/, extension)
    : `${name}${extension}`;
}

function canvasToImageDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): string {
  const dataUrl = canvas.toDataURL(mimeType, quality);
  return dataUrl.startsWith(`data:${mimeType};`) ? dataUrl : "";
}

type StreamAttachmentMetadata = {
  streamuiImage?: ImageAttachment;
  streamuiFile?: UploadedSessionFile;
};

type StreamPendingAttachment = PendingAttachment & StreamAttachmentMetadata;
type StreamCompleteAttachment = CompleteAttachment & StreamAttachmentMetadata;

type StreamImageAttachmentAdapterOptions = {
  getSessionId(): string;
  uploadImage(
    sessionId: string,
    attachment: ImageAttachment
  ): Promise<UploadedSessionFile>;
  deleteFile?(sessionId: string, fileId: string): Promise<void>;
  onUploadStart?(attachmentId: string): void;
  onUploadComplete?(attachmentId: string): void;
  onUploadError?(attachmentId: string): void;
  onRemove?(attachmentId: string): void;
};

async function prepareImageAttachment(file: File): Promise<ImageAttachment> {
  if (
    !SUPPORTED_IMAGE_MIME_TYPES.includes(
      file.type as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]
    )
  ) {
    throw new Error(`${file.name} is not a supported image type.`);
  }

  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`${file.name} is larger than 8 MB.`);
  }

  const originalDataUrl = await readFileAsDataUrl(file);

  if (file.type === "image/gif") {
    return {
      id: createId("image"),
      name: file.name,
      mimeType: file.type,
      size: estimateDataUrlBytes(originalDataUrl),
      dataUrl: originalDataUrl
    };
  }

  const image = await loadImage(originalDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight)
  );

  if (file.size <= TARGET_IMAGE_BYTES && scale === 1) {
    return {
      id: createId("image"),
      name: file.name,
      mimeType: file.type,
      size: estimateDataUrlBytes(originalDataUrl),
      dataUrl: originalDataUrl,
      width: sourceWidth,
      height: sourceHeight
    };
  }

  if (file.type === "image/png" && scale === 1) {
    return {
      id: createId("image"),
      name: file.name,
      mimeType: file.type,
      size: estimateDataUrlBytes(originalDataUrl),
      dataUrl: originalDataUrl,
      width: sourceWidth,
      height: sourceHeight
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(`Could not prepare ${file.name}.`);
  }

  if (file.type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const outputMimeType = file.type;
  let dataUrl = "";

  if (QUALITY_COMPRESSIBLE_IMAGE_MIME_TYPES.has(outputMimeType)) {
    let quality = 0.9;
    dataUrl = canvasToImageDataUrl(canvas, outputMimeType, quality);
    while (
      dataUrl &&
      estimateDataUrlBytes(dataUrl) > TARGET_IMAGE_BYTES &&
      quality > 0.62
    ) {
      quality -= 0.08;
      dataUrl = canvasToImageDataUrl(canvas, outputMimeType, quality);
    }
  } else {
    dataUrl = canvasToImageDataUrl(canvas, outputMimeType);
  }

  if (!dataUrl) {
    return {
      id: createId("image"),
      name: file.name,
      mimeType: file.type,
      size: estimateDataUrlBytes(originalDataUrl),
      dataUrl: originalDataUrl,
      width: sourceWidth,
      height: sourceHeight
    };
  }

  return {
    id: createId("image"),
    name: replaceFileExtension(file.name, outputMimeType),
    mimeType: outputMimeType,
    size: estimateDataUrlBytes(dataUrl),
    dataUrl,
    width: canvas.width,
    height: canvas.height
  };
}

export function completeAttachmentToImage(
  attachment: CompleteAttachment
): ImageAttachment | null {
  const streamAttachment = attachment as StreamCompleteAttachment;
  if (streamAttachment.streamuiImage) {
    return streamAttachment.streamuiImage;
  }

  const imagePart = attachment.content.find((part) => part.type === "image");
  if (!imagePart || imagePart.type !== "image") {
    return null;
  }

  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.contentType ?? "image/png",
    size: estimateDataUrlBytes(imagePart.image),
    dataUrl: imagePart.image,
    sessionFile: streamAttachment.streamuiFile
  };
}

export function imageAttachmentToCompleteAttachment(
  attachment: ImageAttachment
): CompleteAttachment {
  return {
    id: attachment.id,
    type: "image",
    name: attachment.name,
    contentType: attachment.mimeType,
    status: { type: "complete" },
    content: [
      {
        type: "image",
        image: attachment.dataUrl,
        filename: attachment.name
      }
    ],
    streamuiImage: attachment,
    streamuiFile: attachment.sessionFile
  } as StreamCompleteAttachment;
}

export class StreamImageAttachmentAdapter implements AttachmentAdapter {
  accept = SUPPORTED_IMAGE_MIME_TYPES.join(",");

  constructor(private readonly options?: StreamImageAttachmentAdapterOptions) {}

  async *add({
    file
  }: {
    file: File;
  }): AsyncGenerator<PendingAttachment, void> {
    if (
      !SUPPORTED_IMAGE_MIME_TYPES.includes(
        file.type as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]
      )
    ) {
      throw new Error(`${file.name} is not a supported image type.`);
    }

    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error(`${file.name} is larger than 8 MB.`);
    }

    const id = createId("pending-image");
    this.options?.onUploadStart?.(id);
    yield {
      id,
      type: "image",
      name: file.name,
      contentType: file.type,
      file,
      status: { type: "running", reason: "uploading", progress: 0 }
    };

    try {
      const prepared = await prepareImageAttachment(file);
      const uploaded = this.options
        ? await this.options.uploadImage(this.options.getSessionId(), prepared)
        : undefined;
      const image = uploaded
        ? {
            ...prepared,
            id: uploaded.id,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            size: uploaded.size,
            width: uploaded.width ?? prepared.width,
            height: uploaded.height ?? prepared.height,
            sessionFile: uploaded
          }
        : prepared;

      this.options?.onUploadComplete?.(id);
      yield {
        id,
        type: "image",
        name: image.name,
        contentType: image.mimeType,
        file,
        status: { type: "requires-action", reason: "composer-send" },
        content: [
          {
            type: "image",
            image: image.dataUrl,
            filename: image.name
          }
        ],
        streamuiImage: image,
        streamuiFile: image.sessionFile
      } as StreamPendingAttachment;
    } catch (error) {
      this.options?.onUploadError?.(id);
      throw error;
    }
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const streamAttachment = attachment as StreamPendingAttachment;
    if (streamAttachment.streamuiImage) {
      return imageAttachmentToCompleteAttachment(streamAttachment.streamuiImage);
    }

    const prepared = await prepareImageAttachment(attachment.file);
    const uploaded = this.options
      ? await this.options.uploadImage(this.options.getSessionId(), prepared)
      : undefined;
    const image = uploaded
      ? {
          ...prepared,
          id: uploaded.id,
          name: uploaded.name,
          mimeType: uploaded.mimeType,
          size: uploaded.size,
          width: uploaded.width ?? prepared.width,
          height: uploaded.height ?? prepared.height,
          sessionFile: uploaded
        }
      : prepared;

    return imageAttachmentToCompleteAttachment(image);
  }

  async remove(attachment: PendingAttachment | CompleteAttachment): Promise<void> {
    const streamAttachment = attachment as StreamAttachmentMetadata;
    const fileId = streamAttachment.streamuiFile?.id;
    this.options?.onRemove?.(attachment.id);

    if (!fileId || !this.options?.deleteFile) {
      return;
    }

    try {
      await this.options.deleteFile(this.options.getSessionId(), fileId);
    } catch (error) {
      console.warn("Could not delete draft image upload.", error);
    }
  }
}

export { MAX_IMAGE_ATTACHMENTS };
