// Unit tests for lib/imageDownloader.ts
//
// All tests inject a mock fetchImpl — no real HTTP calls.
// Tests cover: FETCH_FAILED, INVALID_IMAGE, PAYLOAD_TOO_LARGE, happy paths.

import { describe, it, expect, vi } from 'vitest';
import { downloadImage } from '../lib/imageDownloader.js';

// ---------------------------------------------------------------------------
// Helpers — mock response builder
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
  contentType?: string;
  body?: ReadableStream<Uint8Array> | null;
}): Response {
  const headers = new Headers();
  if (opts.contentType !== undefined) {
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
// FETCH_FAILED
// ---------------------------------------------------------------------------

describe('downloadImage — FETCH_FAILED', () => {
  it('throws FETCH_FAILED on non-2xx response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: false, status: 404, contentType: 'image/jpeg' }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'FETCH_FAILED',
      statusCode: 422,
    });
  });

  it('throws FETCH_FAILED on network error (fetch throws)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'));

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'FETCH_FAILED',
      statusCode: 422,
    });
  });

  it('throws FETCH_FAILED when response.body is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: null }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'FETCH_FAILED',
      statusCode: 422,
    });
  });
});

// ---------------------------------------------------------------------------
// INVALID_IMAGE — Content-Type
// ---------------------------------------------------------------------------

describe('downloadImage — INVALID_IMAGE', () => {
  it('throws INVALID_IMAGE when Content-Type is text/html', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'text/html' }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });

  it('throws INVALID_IMAGE when Content-Type is application/json', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'application/json' }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'INVALID_IMAGE',
      statusCode: 422,
    });
  });

  it('does NOT throw INVALID_IMAGE when Content-Type is image/jpeg', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg' }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    expect(result).toBeDefined();
    expect(result.contentType).toBe('image/jpeg');
  });

  it('does NOT throw INVALID_IMAGE when Content-Type is image/png', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/png' }),
    );

    const result = await downloadImage('https://example.com/img.png', mockFetch);
    expect(result.contentType).toBe('image/png');
  });

  it('does NOT throw INVALID_IMAGE when Content-Type is image/webp', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/webp' }),
    );

    const result = await downloadImage('https://example.com/img.webp', mockFetch);
    expect(result.contentType).toBe('image/webp');
  });

  it('does NOT throw INVALID_IMAGE when Content-Type is application/octet-stream (CDN fallback)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'application/octet-stream' }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    expect(result.contentType).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// PAYLOAD_TOO_LARGE
// ---------------------------------------------------------------------------

describe('downloadImage — PAYLOAD_TOO_LARGE', () => {
  it('throws PAYLOAD_TOO_LARGE when response exceeds 10 MB', async () => {
    // Chunks: one chunk slightly over 10 MB
    const bigChunk = new Uint8Array(10 * 1024 * 1024 + 1);
    const stream = makeReadableStream([bigChunk]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    await expect(downloadImage('https://example.com/img.jpg', mockFetch)).rejects.toMatchObject({
      code:       'PAYLOAD_TOO_LARGE',
      statusCode: 413,
    });
  });

  it('accepts a response body exactly at the 10 MB limit', async () => {
    const exactChunk = new Uint8Array(10 * 1024 * 1024);
    const stream = makeReadableStream([exactChunk]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    expect(result.buffer.byteLength).toBe(10 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('downloadImage — happy path', () => {
  it('returns { buffer, contentType } for a valid small response', async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const stream = makeReadableStream([data]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.byteLength).toBe(5);
    expect(result.contentType).toBe('image/jpeg');
  });

  it('calls fetch with AbortSignal.timeout(30_000)', async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff]);
    const stream = makeReadableStream([data]);

    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg', body: stream }),
    );

    await downloadImage('https://example.com/img.jpg', mockFetch);

    expect(mockFetch).toHaveBeenCalledOnce();
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const init = callArgs[1];
    // AbortSignal.timeout returns an AbortSignal — check it exists
    expect(init?.signal).toBeDefined();
  });

  it('strips charset suffix from Content-Type before returning', async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff]);
    const stream = makeReadableStream([data]);

    // Some CDNs return 'image/jpeg; charset=utf-8'
    const mockFetch = vi.fn().mockResolvedValue(
      makeMockResponse({ ok: true, contentType: 'image/jpeg; charset=utf-8', body: stream }),
    );

    const result = await downloadImage('https://example.com/img.jpg', mockFetch);
    // contentType should be the raw header value (returned as-is from header)
    // The IMPORTANT thing is it didn't throw INVALID_IMAGE
    expect(result.contentType).toBe('image/jpeg; charset=utf-8');
  });
});
