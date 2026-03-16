// Unit tests for pdfDownloader.downloadPdf
//
// All tests inject a mock fetchImpl — no real network calls.
// Tests cover: success cases (pdf, octet-stream), error cases
// (non-2xx, bad content-type, size exceeded, network error).

import { describe, it, expect, vi } from 'vitest';
import { downloadPdf } from '../../lib/pdfDownloader.js';

// ---------------------------------------------------------------------------
// Helper: build a mock Response-like object
// ---------------------------------------------------------------------------

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

function makeResponse(opts: {
  status?: number;
  contentType?: string;
  body?: Uint8Array | null;
}): Response {
  const status = opts.status ?? 200;
  const ok = status >= 200 && status < 300;
  const contentType = opts.contentType ?? 'application/pdf';
  const body = opts.body ?? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

  // Build a ReadableStream from the body bytes
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (body !== null) {
        controller.enqueue(body);
      }
      controller.close();
    },
  });

  return {
    ok,
    status,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      },
    },
    body: stream,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('downloadPdf', () => {
  it('1. 200 + Content-Type: application/pdf → returns Buffer', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ contentType: 'application/pdf' }),
    );

    const result = await downloadPdf('https://example.com/menu.pdf', mockFetch);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/menu.pdf',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('2. 200 + Content-Type: application/octet-stream → returns Buffer', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ contentType: 'application/octet-stream' }),
    );

    const result = await downloadPdf('https://example.com/menu.pdf', mockFetch);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('3. 404 response → throws Error with code FETCH_FAILED', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ status: 404, contentType: 'text/html' }),
    );

    await expect(
      downloadPdf('https://example.com/menu.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('4. 200 + Content-Type: text/html → throws Error with code INVALID_PDF', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ contentType: 'text/html' }),
    );

    await expect(
      downloadPdf('https://example.com/menu.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'INVALID_PDF' });
  });

  it('5. body > 20 MB → throws Error with code PAYLOAD_TOO_LARGE', async () => {
    // Construct a response whose body yields MAX_SIZE + 1 bytes in a single chunk
    const oversizedBody = new Uint8Array(MAX_SIZE + 1);
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ contentType: 'application/pdf', body: oversizedBody }),
    );

    await expect(
      downloadPdf('https://example.com/large.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('6. fetchImpl throws TypeError (network error) → throws Error with code FETCH_FAILED', async () => {
    const mockFetch = vi.fn().mockRejectedValue(
      new TypeError('Failed to fetch'),
    );

    await expect(
      downloadPdf('https://example.com/menu.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });
});
