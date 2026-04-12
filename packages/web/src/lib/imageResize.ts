// BUG-PROD-001 — Client-side image downscaler for the photo upload flow.
//
// Mobile photos routinely exceed 4.5 MB, which is the Vercel Serverless Function
// body limit on the /api/analyze proxy route. We downscale before upload so the
// request stays well under the platform limit and reaches the Fastify backend.
//
// Contract:
//   - Small files (< PASSTHROUGH_THRESHOLD) are returned unchanged.
//   - Large files are re-encoded as JPEG at quality ~0.82 with the longest edge
//     capped at MAX_LONG_EDGE_PX.
//   - Any failure (decode error, missing APIs, resized blob not smaller) returns
//     the ORIGINAL file rather than blocking the user.
//
// This utility is browser-only. Tests install jest mocks on globalThis for
// createImageBitmap / OffscreenCanvas.

const PASSTHROUGH_THRESHOLD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB
const MAX_LONG_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;

interface BitmapLike {
  width: number;
  height: number;
  close?: () => void;
}

interface OffscreenCanvasLike {
  getContext(type: '2d'): unknown | null;
  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
}

interface CanvasContextLike {
  drawImage(
    image: BitmapLike,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

function hasBrowserSupport(): boolean {
  const g = globalThis as {
    createImageBitmap?: unknown;
    OffscreenCanvas?: unknown;
  };
  return (
    typeof g.createImageBitmap === 'function' &&
    typeof g.OffscreenCanvas === 'function'
  );
}

export async function resizeImageForUpload(file: File): Promise<File> {
  // Passthrough: small files are already well under the Vercel body limit.
  if (file.size <= PASSTHROUGH_THRESHOLD_BYTES) {
    return file;
  }

  // Feature detection: if the browser can't do this, don't block the upload.
  if (!hasBrowserSupport()) {
    return file;
  }

  try {
    const g = globalThis as {
      createImageBitmap: (
        blob: Blob,
        options?: { imageOrientation?: 'from-image' | 'none' },
      ) => Promise<BitmapLike>;
      OffscreenCanvas: new (w: number, h: number) => OffscreenCanvasLike;
    };

    const bitmap = await g.createImageBitmap(file, {
      imageOrientation: 'from-image',
    });

    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    const scale = longEdge > MAX_LONG_EDGE_PX ? MAX_LONG_EDGE_PX / longEdge : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = new g.OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d') as CanvasContextLike | null;
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close?.();

    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: JPEG_QUALITY,
    });

    // Safety net: if the re-encoded blob is not actually smaller, keep the
    // original. This protects against degenerate inputs (already compressed
    // below our quality target, tiny panoramas that fit in memory, etc.).
    if (blob.size >= file.size) {
      return file;
    }

    const newName = file.name.replace(/\.(heic|heif|png|webp|jpeg|jpg)$/i, '.jpg');
    return new File([blob], newName.endsWith('.jpg') ? newName : `${newName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    // Any decode / canvas / blob failure → fall back to the original.
    return file;
  }
}
