// Edge-case tests for lib/imageDownloader.ts
//
// Covers gaps not addressed in the developer-written unit tests:
//   1. Spec deviation: image/gif and other non-allowed image/* subtypes
//   2. Multi-chunk accumulation crossing the 10 MB boundary
//   3. Missing Content-Type header (empty string)
//   4. Content-Type with uppercase (case-insensitivity)
//   5. One-byte-below the 10 MB limit (exact boundary off-by-one)
//   6. Buffer is correctly assembled from multiple chunks
//   7. image/gif passes Content-Type guard — spec says only jpeg/png/webp/octet-stream allowed

import { describe, it, expect, vi } from 'vitest';
import { downloadImage } from '../lib/imageDownloader.js';

// ---------------------------------------------------------------------------
// Helpers — reused from the developer's unit test (duplicated here so this
// file is self-contained and does not depend on the other test file)
// ---------------------------------------------------------------------------

function makeReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const chunk = chunks[i++];
        if (chunk !== undefined) {
          controller.enqueue(chunk);
        }
      } else {
        controller.close();
      }
    },
  });
}

function makeMockResponse(opts: {
  ok: boolean;
  status?: number;
  contentType?: string | null;
  body?: ReadableStream<Uint8Array> | null;
}): Response {
  const headers = new Headers();
  if (opts.contentType !== null && opts.contentType !== undefined) {
    headers.set('content-type', opts.contentType);
  }
  return {
    ok:      opts.ok,
    status:  opts.status ?? (opts.ok ? 200 : 404),
    headers,
    body:    opts.body !== undefined ? opts.body : makeReadableStream([new Uint8Array([0xff, 0xd8, 0xff])]),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// EC-D1: Spec deviation — image/webp is in the spec allow-list but NOT
// in the implementation's ALLOWED_CONTENT_TYPES set.
//
// Spec (Updated Content-Type allow-list — F012 ticket):
//   - image/jpeg        ✓ in implementation
//   - image/png         ✓ in implementation
//   - image/webp        ✗ MISSING from implementation (Phase 1 scope decision)
//   - application/octet-stream  ✓ in implementation
//
// The developer made a deliberate Phase 1 scope decision: only JPEG and PNG
// are supported in Phase 1 (Domino's serves JPEGs). The spec lists webp in
// the allow-list but the implementation rejects it with INVALID_IMAGE.
//
// These tests document the behaviour of the implementation and the spec gap.
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D1: spec deviation — image/webp rejected (not in Phase 1 allow-list)', () => {
  it('[SPEC GAP] image/webp throws INVALID_IMAGE — spec lists it as allowed but Phase 1 excludes it', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/webp' }),
    );

    // This documents the deviation: spec says webp is allowed, implementation rejects it.
    // If image/webp support is added, this test should be updated to resolves.
    await expect(downloadImage('https://example.com/img.webp', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });

  it('image/gif throws INVALID_IMAGE (correctly excluded — not in spec or implementation)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/gif' }),
    );

    // image/gif is not in the spec allow-list AND not in the implementation.
    // Both spec and implementation agree this should throw INVALID_IMAGE.
    await expect(downloadImage('https://example.com/anim.gif', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });

  it('image/svg+xml throws INVALID_IMAGE (SVG cannot be OCRed; correctly excluded)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/svg+xml' }),
    );

    await expect(downloadImage('https://example.com/logo.svg', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });

  it('image/tiff throws INVALID_IMAGE (not in spec allow-list; correctly excluded)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/tiff' }),
    );

    await expect(downloadImage('https://example.com/scan.tiff', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });
});

// ---------------------------------------------------------------------------
// EC-D2: Multi-chunk accumulation — size cap fires across chunk boundary
//
// The spec says: totalBytes > 10MB → PAYLOAD_TOO_LARGE
// The developer test only tested a single oversized chunk.
// Here we test two chunks that are each under 10MB individually but
// exceed the cap cumulatively.
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D2: PAYLOAD_TOO_LARGE on multi-chunk accumulation', () => {
  it('throws PAYLOAD_TOO_LARGE when two chunks together exceed 10 MB', async () => {
    // 6 MB + 5 MB = 11 MB total → should exceed cap
    const chunk1 = new Uint8Array(6 * 1024 * 1024);
    const chunk2 = new Uint8Array(5 * 1024 * 1024);
    const stream = makeReadableStream([chunk1, chunk2]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'PAYLOAD_TOO_LARGE',
      statusCode: 413,
    });
  });

  it('accepts two chunks whose combined size is exactly 10 MB', async () => {
    // 5 MB + 5 MB = exactly 10 MB → should pass
    const chunk1 = new Uint8Array(5 * 1024 * 1024);
    const chunk2 = new Uint8Array(5 * 1024 * 1024);
    const stream = makeReadableStream([chunk1, chunk2]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    expect(result.buffer.byteLength).toBe(10 * 1024 * 1024);
  });

  it('throws PAYLOAD_TOO_LARGE when second chunk pushes total to 10MB + 1 byte', async () => {
    // This tests the exact off-by-one: 10MB is allowed, 10MB+1 is not.
    const chunk1 = new Uint8Array(10 * 1024 * 1024);      // exactly 10 MB
    const chunk2 = new Uint8Array(1);                       // 1 additional byte
    const stream = makeReadableStream([chunk1, chunk2]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'PAYLOAD_TOO_LARGE',
      statusCode: 413,
    });
  });
});

// ---------------------------------------------------------------------------
// EC-D3: Missing Content-Type header (empty / absent)
//
// When the server sends no Content-Type, response.headers.get('content-type')
// returns null. The implementation uses ?? '' to default to empty string.
// ctBase will be '' which is neither image/* nor application/octet-stream.
// Expected: throws INVALID_IMAGE (422).
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D3: missing Content-Type header', () => {
  it('throws INVALID_IMAGE when Content-Type header is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: null }), // no Content-Type header
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });

  it('throws INVALID_IMAGE when Content-Type is an empty string', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: '' }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });
});

// ---------------------------------------------------------------------------
// EC-D4: Content-Type case-insensitivity
//
// The implementation lowercases the Content-Type before comparison.
// Tests that uppercase variants are handled correctly.
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D4: Content-Type case-insensitivity', () => {
  it('accepts "IMAGE/JPEG" (fully uppercase) as valid Content-Type', async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff]);
    const stream = makeReadableStream([data]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'IMAGE/JPEG', body: stream }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    // Should not throw — implementation lowercases before checking
    expect(result).toBeDefined();
  });

  it('accepts "Image/Png" (mixed case) as valid Content-Type', async () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const stream = makeReadableStream([data]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'Image/Png', body: stream }),
    );

    const result = await downloadImage('https://example.com/img.png', mockFetch);
    expect(result).toBeDefined();
  });

  it('accepts "APPLICATION/OCTET-STREAM" (uppercase octet-stream) as CDN fallback', async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff]);
    const stream = makeReadableStream([data]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'APPLICATION/OCTET-STREAM', body: stream }),
    );

    const result = await downloadImage('https://example.com/img', mockFetch);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EC-D5: Buffer assembly correctness
//
// Verifies that multiple chunks are correctly concatenated into a single Buffer.
// Not just the total size, but the actual byte content preserved.
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D5: buffer assembly from multiple chunks', () => {
  it('returns a correctly concatenated Buffer from three chunks', async () => {
    const chunk1 = new Uint8Array([0x01, 0x02, 0x03]);
    const chunk2 = new Uint8Array([0x04, 0x05]);
    const chunk3 = new Uint8Array([0x06, 0x07, 0x08, 0x09]);
    const stream = makeReadableStream([chunk1, chunk2, chunk3]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    expect(result.buffer.byteLength).toBe(9);
    expect(Array.from(result.buffer)).toEqual([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
  });
});

// ---------------------------------------------------------------------------
// EC-D6: Non-2xx status codes — various HTTP error statuses
//
// The developer test only covered 404. Other status codes should also
// throw FETCH_FAILED.
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D6: FETCH_FAILED on various non-2xx statuses', () => {
  it.each([301, 400, 403, 500, 502, 503])(
    'throws FETCH_FAILED for HTTP %i response',
    async (status) => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeMockResponse({ ok: false, status, contentType: 'image/jpeg' }),
      );

      await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
        code:       'FETCH_FAILED',
        statusCode: 422,
      });
    },
  );
});

// ---------------------------------------------------------------------------
// EC-D7: AbortError maps to FETCH_FAILED (timeout scenario)
//
// When fetch is aborted (e.g. AbortSignal.timeout fires), an AbortError is
// thrown by fetch. The implementation catches all fetch errors and maps them
// to FETCH_FAILED.
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D7: AbortError (timeout) maps to FETCH_FAILED', () => {
  it('throws FETCH_FAILED when fetch throws an AbortError', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const mockFetch = vi.fn().mockRejectedValue(abortError);

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'FETCH_FAILED',
      statusCode: 422,
    });
  });
});

// ---------------------------------------------------------------------------
// EC-D8: reader.releaseLock() is always called (resource cleanup)
//
// The implementation wraps the read loop in try/finally { reader.releaseLock() }.
// Verify that the lock is released even when PAYLOAD_TOO_LARGE is thrown mid-stream.
// We do this indirectly: if releaseLock() were NOT called, a subsequent read on
// the same stream would throw "ReadableStream is locked". Since we can't inspect
// the lock externally via the mock, we instead verify that the stream's cancel()
// is called when the size cap is exceeded.
// ---------------------------------------------------------------------------

describe('downloadImage — EC-D8: stream reader cleanup on PAYLOAD_TOO_LARGE', () => {
  it('calls reader.cancel() when size limit is exceeded', async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const releaseLockSpy = vi.fn();

    // Build a mock body with a spy on the reader methods
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array(10 * 1024 * 1024 + 1) })
          .mockResolvedValue({ done: true, value: undefined }),
        cancel: cancelSpy,
        releaseLock: releaseLockSpy,
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok:      true,
      status:  200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body:    mockBody,
    } as unknown as Response);

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });

    // cancel() should have been called to abort the stream
    expect(cancelSpy).toHaveBeenCalled();
    // releaseLock() should have been called in finally
    expect(releaseLockSpy).toHaveBeenCalled();
  });
});
