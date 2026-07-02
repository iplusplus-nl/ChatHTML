import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import {
  MAX_IMAGE_ATTACHMENTS,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ImageAttachment
} from "../core/imageAttachments";

type ChatInputProps = {
  isSending: boolean;
  onSend(message: string, attachments: ImageAttachment[]): void;
};

const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 1.8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

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
    image.addEventListener("error", () => reject(new Error("Could not decode the image.")));
    image.src = dataUrl;
  });
}

async function prepareImageAttachment(file: File): Promise<ImageAttachment> {
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(file.type as typeof SUPPORTED_IMAGE_MIME_TYPES[number])) {
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

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(`Could not prepare ${file.name}.`);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (estimateDataUrlBytes(dataUrl) > TARGET_IMAGE_BYTES && quality > 0.62) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  return {
    id: createId("image"),
    name: file.name.replace(/\.[^.]+$/, ".jpg"),
    mimeType: "image/jpeg",
    size: estimateDataUrlBytes(dataUrl),
    dataUrl,
    width: canvas.width,
    height: canvas.height
  };
}

export function ChatInput({ isSending, onSend }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const submit = () => {
    const nextValue = value.trim();
    if ((!nextValue && attachments.length === 0) || isSending || isPreparingImages) {
      return;
    }
    onSend(nextValue, attachments);
    setValue("");
    setAttachments([]);
    setAttachmentError("");
    textareaRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    const remainingSlots = MAX_IMAGE_ATTACHMENTS - attachments.length;
    const selectedFiles = Array.from(files).slice(0, Math.max(0, remainingSlots));

    if (selectedFiles.length === 0) {
      setAttachmentError(`You can attach up to ${MAX_IMAGE_ATTACHMENTS} images.`);
      return;
    }

    setIsPreparingImages(true);
    setAttachmentError("");

    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map((file) => prepareImageAttachment(file))
      );
      setAttachments((current) => [...current, ...nextAttachments]);
      if (files.length > selectedFiles.length) {
        setAttachmentError(`Only ${MAX_IMAGE_ATTACHMENTS} images can be attached.`);
      }
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Could not attach that image."
      );
    } finally {
      setIsPreparingImages(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const canSubmit =
    (value.trim().length > 0 || attachments.length > 0) &&
    !isSending &&
    !isPreparingImages;

  return (
    <form className="chat-input-bar" onSubmit={handleSubmit}>
      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <button
        className="attach-button"
        type="button"
        disabled={isSending || isPreparingImages || attachments.length >= MAX_IMAGE_ATTACHMENTS}
        aria-label="Attach images"
        title="Attach images"
        onClick={() => fileInputRef.current?.click()}
      >
        +
      </button>
      <div className="chat-input-main">
        {attachments.length > 0 ? (
          <div className="attachment-tray" aria-label="Attached images">
            {attachments.map((attachment) => (
              <figure className="attachment-thumb" key={attachment.id}>
                <img src={attachment.dataUrl} alt={attachment.name} />
                <figcaption>{attachment.name}</figcaption>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                >
                  x
                </button>
              </figure>
            ))}
          </div>
        ) : null}
        {attachmentError ? (
          <p className="attachment-error">{attachmentError}</p>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder="Ask about an image, webpage, explainer, calculator..."
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <button
        className="send-button"
        type="submit"
        disabled={!canSubmit}
        aria-label="Send message"
      >
        {isPreparingImages ? "..." : "↑"}
      </button>
    </form>
  );
}
