export const MAX_PROFILE_AVATAR_SOURCE_BYTES = 50_000_000;
export const MAX_PROFILE_AVATAR_SOURCE_PIXELS = 80_000_000;
export const PROFILE_AVATAR_MAX_DIMENSION = 512;
export const PROFILE_AVATAR_TARGET_BYTES = 600_000;

const SUPPORTED_AVATAR_TYPE = /^image\/(?:png|jpeg|webp|gif)$/i;
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,/i;
const AVATAR_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4] as const;
const AVATAR_SIZE_SCALES = [1, 0.8, 0.65, 0.5, 0.35] as const;

export type DecodedAvatarImage = {
  width: number;
  height: number;
  source: unknown;
  dispose(): void;
};

export type ProfileAvatarCompressionDependencies = {
  decode(file: Blob): Promise<DecodedAvatarImage>;
  encode(
    image: DecodedAvatarImage,
    width: number,
    height: number,
    quality: number
  ): Promise<string>;
};

export function fitProfileAvatarDimensions(
  width: number,
  height: number,
  maxDimension = PROFILE_AVATAR_MAX_DIMENSION
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("This image has invalid dimensions.");
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function profileAvatarDataBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    return Number.POSITIVE_INFINITY;
  }
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The compressed image could not be read."));
    reader.onerror = () =>
      reject(new Error("The compressed image could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function decodeAvatarImage(file: Blob): Promise<DecodedAvatarImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      dispose: () => bitmap.close()
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () =>
        reject(new Error("This image could not be decoded."));
      candidate.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      dispose: () => URL.revokeObjectURL(url)
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

async function encodeAvatarImage(
  image: DecodedAvatarImage,
  width: number,
  height: number,
  quality: number
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("Image compression is unavailable in this browser.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source as CanvasImageSource, 0, 0, width, height);

  const blob =
    (await canvasBlob(canvas, "image/webp", quality)) ??
    (await canvasBlob(canvas, "image/jpeg", quality));
  if (!blob) {
    throw new Error("This image could not be compressed.");
  }
  return blobDataUrl(blob);
}

const browserCompressionDependencies: ProfileAvatarCompressionDependencies = {
  decode: decodeAvatarImage,
  encode: encodeAvatarImage
};

export async function compressProfileAvatar(
  file: Blob,
  dependencies: ProfileAvatarCompressionDependencies =
    browserCompressionDependencies
): Promise<string> {
  if (!SUPPORTED_AVATAR_TYPE.test(file.type)) {
    throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  }
  if (file.size > MAX_PROFILE_AVATAR_SOURCE_BYTES) {
    throw new Error("Choose an image smaller than 50 MB.");
  }

  const image = await dependencies.decode(file);
  try {
    if (image.width * image.height > MAX_PROFILE_AVATAR_SOURCE_PIXELS) {
      throw new Error("This image is too large to process safely.");
    }
    const fitted = fitProfileAvatarDimensions(image.width, image.height);
    let smallest: { dataUrl: string; bytes: number } | null = null;

    for (const sizeScale of AVATAR_SIZE_SCALES) {
      const width = Math.max(1, Math.round(fitted.width * sizeScale));
      const height = Math.max(1, Math.round(fitted.height * sizeScale));
      for (const quality of AVATAR_QUALITIES) {
        const dataUrl = await dependencies.encode(image, width, height, quality);
        if (!RASTER_DATA_URL.test(dataUrl)) {
          throw new Error("The compressed image format is not supported.");
        }
        const bytes = profileAvatarDataBytes(dataUrl);
        if (!smallest || bytes < smallest.bytes) {
          smallest = { dataUrl, bytes };
        }
        if (bytes <= PROFILE_AVATAR_TARGET_BYTES) {
          return dataUrl;
        }
      }
    }

    throw new Error(
      smallest
        ? "This image could not be compressed enough for local storage."
        : "This image could not be compressed."
    );
  } finally {
    image.dispose();
  }
}
