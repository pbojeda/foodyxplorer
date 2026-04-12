// BUG-PROD-001 — Tests for resizeImageForUpload.
//
// The real implementation uses createImageBitmap + OffscreenCanvas in the browser.
// We install jest globals for these APIs and exercise the control-flow branches
// (passthrough, downscale, feature-missing fallback, decode-error fallback,
// safety net when re-encoded blob is not smaller).

import { resizeImageForUpload } from '../../lib/imageResize';

type Bitmap = { width: number; height: number; close?: () => void };

const originalCreateImageBitmap: unknown = (
  globalThis as { createImageBitmap?: unknown }
).createImageBitmap;
const originalOffscreenCanvas: unknown = (
  globalThis as { OffscreenCanvas?: unknown }
).OffscreenCanvas;

function makeFile({
  name = 'photo.jpg',
  type = 'image/jpeg',
  size = 1024,
}: { name?: string; type?: string; size?: number } = {}): File {
  // We construct a small File and then override .size so we don't allocate huge buffers.
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
}

function installBitmapSupport({
  bitmap,
  blobSize,
  bitmapThrows = false,
  missingOffscreen = false,
  missingCreateBitmap = false,
}: {
  bitmap?: Bitmap;
  blobSize?: number;
  bitmapThrows?: boolean;
  missingOffscreen?: boolean;
  missingCreateBitmap?: boolean;
} = {}): void {
  const g = globalThis as Record<string, unknown>;

  if (missingCreateBitmap) {
    delete g['createImageBitmap'];
  } else {
    g['createImageBitmap'] = jest.fn().mockImplementation(() => {
      if (bitmapThrows) return Promise.reject(new Error('decode failed'));
      return Promise.resolve(
        bitmap ?? { width: 4000, height: 3000, close: jest.fn() },
      );
    });
  }

  if (missingOffscreen) {
    delete g['OffscreenCanvas'];
    return;
  }

  const fakeCtx = {
    drawImage: jest.fn(),
  };
  const fakeCanvas = {
    getContext: jest.fn().mockReturnValue(fakeCtx),
    convertToBlob: jest.fn().mockResolvedValue(
      new Blob([new Uint8Array(blobSize ?? 200 * 1024)], { type: 'image/jpeg' }),
    ),
  };
  g['OffscreenCanvas'] = jest.fn().mockImplementation(() => fakeCanvas);
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  if (originalCreateImageBitmap === undefined) {
    delete g['createImageBitmap'];
  } else {
    g['createImageBitmap'] = originalCreateImageBitmap;
  }
  if (originalOffscreenCanvas === undefined) {
    delete g['OffscreenCanvas'];
  } else {
    g['OffscreenCanvas'] = originalOffscreenCanvas;
  }
  jest.clearAllMocks();
});

describe('resizeImageForUpload', () => {
  it('returns the original file unchanged when size is under the threshold', async () => {
    const small = makeFile({ size: 500 * 1024 }); // 500 KB
    installBitmapSupport();

    const result = await resizeImageForUpload(small);

    expect(result).toBe(small);
    expect(
      (globalThis as { createImageBitmap?: jest.Mock }).createImageBitmap,
    ).not.toHaveBeenCalled();
  });

  it('downscales a large file to a new JPEG File smaller than the original', async () => {
    const big = makeFile({ name: 'plate.jpeg', size: 6 * 1024 * 1024 });
    installBitmapSupport({
      bitmap: { width: 4032, height: 3024, close: jest.fn() },
      blobSize: 800 * 1024, // 800 KB re-encoded
    });

    const result = await resizeImageForUpload(big);

    expect(result).not.toBe(big);
    expect(result.type).toBe('image/jpeg');
    expect(result.size).toBeLessThan(big.size);
    // Filename should keep its base but end with .jpg
    expect(result.name).toMatch(/\.jpg$/i);
  });

  it('scales the longest edge to <= 1600 px and preserves aspect ratio', async () => {
    const big = makeFile({ size: 6 * 1024 * 1024 });
    installBitmapSupport({
      bitmap: { width: 4000, height: 3000, close: jest.fn() },
      blobSize: 500 * 1024,
    });

    await resizeImageForUpload(big);

    const OffscreenCanvasMock = (
      globalThis as { OffscreenCanvas: jest.Mock }
    ).OffscreenCanvas;
    // 4000:3000 → 1600:1200
    expect(OffscreenCanvasMock).toHaveBeenCalledWith(1600, 1200);
  });

  it('falls back to the original file when createImageBitmap throws', async () => {
    const big = makeFile({ size: 6 * 1024 * 1024 });
    installBitmapSupport({ bitmapThrows: true });

    const result = await resizeImageForUpload(big);

    expect(result).toBe(big);
  });

  it('falls back to the original file when OffscreenCanvas is unavailable', async () => {
    const big = makeFile({ size: 6 * 1024 * 1024 });
    installBitmapSupport({ missingOffscreen: true });

    const result = await resizeImageForUpload(big);

    expect(result).toBe(big);
  });

  it('falls back to the original file when createImageBitmap is unavailable', async () => {
    const big = makeFile({ size: 6 * 1024 * 1024 });
    installBitmapSupport({ missingCreateBitmap: true });

    const result = await resizeImageForUpload(big);

    expect(result).toBe(big);
  });

  it('returns the original file when the re-encoded blob is not actually smaller', async () => {
    const big = makeFile({ size: 2 * 1024 * 1024 });
    installBitmapSupport({
      bitmap: { width: 4000, height: 3000, close: jest.fn() },
      blobSize: 3 * 1024 * 1024, // "resized" blob larger than original
    });

    const result = await resizeImageForUpload(big);

    expect(result).toBe(big);
  });

  it('does not throw when the bitmap has no close() method', async () => {
    const big = makeFile({ size: 6 * 1024 * 1024 });
    installBitmapSupport({
      bitmap: { width: 2000, height: 1000 }, // no close
      blobSize: 400 * 1024,
    });

    await expect(resizeImageForUpload(big)).resolves.toBeDefined();
  });
});
