export const MAX_IMAGE_UPLOAD_BYTES = 100 * 1024;

export interface CompressedImage {
  blob: Blob;
  dataUrl: string;
  contentType: 'image/webp';
  extension: 'webp';
}

export interface ImageCompressionOptions {
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Re-encodes an image before upload. The returned blob is guaranteed to be
 * at or below maxBytes; if the browser cannot produce one, the upload must fail.
 */
export async function compressImageToWebp(
  file: File,
  options: ImageCompressionOptions = {}
): Promise<CompressedImage> {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES;
  const maxWidth = options.maxWidth ?? 1600;
  const maxHeight = options.maxHeight ?? 1600;

  if (!Number.isFinite(maxBytes) || maxBytes < 1024) {
    throw new Error('Image size limit is invalid.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) {
      throw new Error('Selected file is not a valid image.');
    }

    const initialScale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
    let width = Math.max(1, Math.round(naturalWidth * initialScale));
    let height = Math.max(1, Math.round(naturalHeight * initialScale));
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34, 0.28];

    for (let dimensionPass = 0; dimensionPass < 8; dimensionPass += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Image compression is unavailable in this browser.');
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const blob = await encodeWebp(canvas, quality);
        if (blob.size <= maxBytes) {
          return {
            blob,
            dataUrl: await blobToDataUrl(blob),
            contentType: 'image/webp',
            extension: 'webp',
          };
        }
      }

      const nextWidth = Math.max(1, Math.floor(width * 0.78));
      const nextHeight = Math.max(1, Math.floor(height * 0.78));
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
    }

    throw new Error('This image cannot be reduced below 100 KB. Please choose a simpler or smaller image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Selected file could not be decoded as an image.'));
    image.src = source;
  });
}

function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to compress this image.'));
        return;
      }
      if (blob.type !== 'image/webp') {
        reject(new Error('This browser does not support WebP image compression.'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to prepare the compressed image preview.'));
    };
    reader.onerror = () => reject(new Error('Unable to prepare the compressed image preview.'));
    reader.readAsDataURL(blob);
  });
}
