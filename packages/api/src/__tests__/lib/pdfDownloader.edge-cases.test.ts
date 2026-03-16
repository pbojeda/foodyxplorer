// Edge-case tests for pdfDownloader.downloadPdf
//
// Complements pdfDownloader.test.ts by covering paths not included in the
// baseline 6-test suite:
//   - Content-Type with parameters (e.g. "application/pdf; charset=utf-8")
//   - Null response body
//   - Server errors beyond 404 (500, 401, 403)
//   - AbortError (timeout simulated)
//   - Exactly MAX_SIZE bytes (boundary — should NOT throw)
//   - MAX_SIZE + 1 bytes via two chunks (multi-chunk size enforcement)
//   - 200 but body delivers zero bytes (empty body)

import { describe, it, expect, vi } from 'vitest';
import { downloadPdf } from '../../lib/pdfDownloader.js';

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Helper: build a mock Response with a streaming body composed of chunks
// ---------------------------------------------------------------------------

function makeStreamResponse(opts: {
  status?: number;
  contentType?: string;
  chunks: Uint8Array[];
}): Response {
  const status = opts.status ?? 200;
  const ok = status >= 200 && status < 300;
  const contentType = opts.contentType ?? 'application/pdf';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of opts.chunks) {
        controller.enqueue(chunk);
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
  } as unknown as Response;
}

function makeNullBodyResponse(contentType = 'application/pdf'): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      },
    },
    body: null,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('downloadPdf — edge cases', () => {
  // ---------------------------------------------------------------------------
  // Content-Type with parameters
  // ---------------------------------------------------------------------------

  it('EC-D1. Content-Type "application/pdf; charset=utf-8" → returns Buffer (params stripped)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({
        contentType: 'application/pdf; charset=utf-8',
        chunks: [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
      }),
    );

    const result = await downloadPdf('https://example.com/menu.pdf', mockFetch);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('EC-D2. Content-Type "application/octet-stream; name=file.pdf" → returns Buffer', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({
        contentType: 'application/octet-stream; name=file.pdf',
        chunks: [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
      }),
    );

    const result = await downloadPdf('https://example.com/file.pdf', mockFetch);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('EC-D3. Content-Type with uppercase "APPLICATION/PDF" → returns Buffer (case-insensitive)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({
        contentType: 'APPLICATION/PDF',
        chunks: [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
      }),
    );

    const result = await downloadPdf('https://example.com/menu.pdf', mockFetch);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Null response body
  // ---------------------------------------------------------------------------

  it('EC-D4. Null response body → throws FETCH_FAILED', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeNullBodyResponse());

    await expect(
      downloadPdf('https://example.com/menu.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  // ---------------------------------------------------------------------------
  // Server errors beyond 404
  // ---------------------------------------------------------------------------

  it('EC-D5. HTTP 500 server error → throws FETCH_FAILED', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({ status: 500, contentType: 'text/html', chunks: [] }),
    );

    await expect(
      downloadPdf('https://example.com/menu.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('EC-D6. HTTP 401 unauthorized → throws FETCH_FAILED', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({ status: 401, contentType: 'text/html', chunks: [] }),
    );

    await expect(
      downloadPdf('https://example.com/menu.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('EC-D7. HTTP 403 forbidden (expired signed URL) → throws FETCH_FAILED', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({ status: 403, contentType: 'text/html', chunks: [] }),
    );

    await expect(
      downloadPdf('https://s3.amazonaws.com/bucket/menu.pdf?sig=expired', mockFetch),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  // ---------------------------------------------------------------------------
  // AbortError (simulated timeout)
  // ---------------------------------------------------------------------------

  it('EC-D8. fetchImpl throws AbortError (timeout) → throws FETCH_FAILED', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const mockFetch = vi.fn().mockRejectedValue(abortError);

    await expect(
      downloadPdf('https://example.com/slow.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  // ---------------------------------------------------------------------------
  // Size boundary: exactly MAX_SIZE should NOT throw
  // ---------------------------------------------------------------------------

  it('EC-D9. Response body exactly 20 MB → returns Buffer (boundary, must NOT throw)', async () => {
    const exactSizeBody = new Uint8Array(MAX_SIZE);
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({
        contentType: 'application/pdf',
        chunks: [exactSizeBody],
      }),
    );

    const result = await downloadPdf('https://example.com/large-but-ok.pdf', mockFetch);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(MAX_SIZE);
  });

  // ---------------------------------------------------------------------------
  // Multi-chunk accumulation: size cap enforced across multiple chunks
  // ---------------------------------------------------------------------------

  it('EC-D10. Body > 20 MB split across two chunks → throws PAYLOAD_TOO_LARGE', async () => {
    // Two chunks of 10.5 MB each = 21 MB total
    const halfPlus = new Uint8Array(MAX_SIZE / 2 + 1);
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({
        contentType: 'application/pdf',
        chunks: [halfPlus, halfPlus],
      }),
    );

    await expect(
      downloadPdf('https://example.com/large.pdf', mockFetch),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  // ---------------------------------------------------------------------------
  // Empty response body (0 bytes, but 200 OK with correct Content-Type)
  // ---------------------------------------------------------------------------

  it('EC-D11. 200 OK with empty body (zero bytes) → returns empty Buffer', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({
        contentType: 'application/pdf',
        chunks: [],
      }),
    );

    const result = await downloadPdf('https://example.com/empty.pdf', mockFetch);

    // downloadPdf does not validate content — that is the caller's responsibility (magic bytes)
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Error message content spec compliance
  // ---------------------------------------------------------------------------

  it('EC-D12. Non-2xx response error message includes HTTP status code', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({ status: 404, contentType: 'text/html', chunks: [] }),
    );

    await expect(
      downloadPdf('https://example.com/missing.pdf', mockFetch),
    ).rejects.toMatchObject({
      code: 'FETCH_FAILED',
      message: expect.stringContaining('404'),
    });
  });

  it('EC-D13. Bad Content-Type error message includes the actual content type', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeStreamResponse({
        contentType: 'text/html',
        chunks: [new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])], // <html
      }),
    );

    await expect(
      downloadPdf('https://example.com/redirect.pdf', mockFetch),
    ).rejects.toMatchObject({
      code: 'INVALID_PDF',
      message: expect.stringContaining('text/html'),
    });
  });
});
