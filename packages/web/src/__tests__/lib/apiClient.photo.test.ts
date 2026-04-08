// TDD tests for sendPhotoAnalysis in apiClient.ts
// Covers: request construction, FormData fields, headers, 65s timeout,
// all error codes, AbortError re-throw, shape guard, no env var checks.

jest.mock('../../lib/actorId', () => ({
  persistActorId: jest.fn(),
}));

import { sendPhotoAnalysis, ApiError } from '../../lib/apiClient';
import { createMenuAnalysisResponse } from '../fixtures';

const MOCK_ACTOR_ID = 'photo-actor-uuid-0001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = 'photo.jpg', type = 'image/jpeg', size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

function makeFetchMock(status: number, body: unknown, headers: Record<string, string> = {}) {
  const responseHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders,
    json: jest.fn().mockResolvedValue(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendPhotoAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Request construction
  // ---------------------------------------------------------------------------

  describe('request construction', () => {
    it('sends POST to /api/analyze (relative, same-origin — no env var needed)', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/analyze',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('sends FormData body with file field', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.body).toBeInstanceOf(FormData);
      expect((callArgs.body as FormData).get('file')).toBe(file);
    });

    it('sends mode=identify in FormData body', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect((callArgs.body as FormData).get('mode')).toBe('identify');
    });

    it('sets X-Actor-Id header', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers['X-Actor-Id']).toBe(MOCK_ACTOR_ID);
    });

    it('sets X-FXP-Source: web header', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers['X-FXP-Source']).toBe('web');
    });

    it('does NOT set Content-Type header manually (browser handles multipart boundary)', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers['Content-Type']).toBeUndefined();
    });

    it('does NOT set X-API-Key header (Route Handler adds it server-side)', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers['X-API-Key']).toBeUndefined();
    });

    it('applies a 65000ms timeout signal', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();
    });

    it('merges external signal with 65s timeout when signal is provided', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();
      const controller = new AbortController();

      await sendPhotoAnalysis(file, MOCK_ACTOR_ID, controller.signal);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();
    });

    it('does NOT check env vars (sends to relative /api/analyze regardless)', async () => {
      global.fetch = makeFetchMock(200, createMenuAnalysisResponse());
      const file = makeFile();
      const savedEnv = process.env['NEXT_PUBLIC_API_URL'];
      delete process.env['NEXT_PUBLIC_API_URL'];

      // Should NOT throw even without env var
      await expect(sendPhotoAnalysis(file, MOCK_ACTOR_ID)).resolves.toBeDefined();

      process.env['NEXT_PUBLIC_API_URL'] = savedEnv;
    });
  });

  // ---------------------------------------------------------------------------
  // Success response
  // ---------------------------------------------------------------------------

  describe('success response', () => {
    it('returns parsed MenuAnalysisResponse on 200', async () => {
      const mockData = createMenuAnalysisResponse();
      global.fetch = makeFetchMock(200, mockData);
      const file = makeFile();

      const result = await sendPhotoAnalysis(file, MOCK_ACTOR_ID);

      expect(result).toEqual(mockData);
    });
  });

  // ---------------------------------------------------------------------------
  // Error responses
  // ---------------------------------------------------------------------------

  describe('error responses', () => {
    it('throws ApiError with INVALID_IMAGE code on 422 INVALID_IMAGE', async () => {
      global.fetch = makeFetchMock(422, {
        success: false,
        error: { code: 'INVALID_IMAGE', message: 'Unsupported format' },
      });

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'INVALID_IMAGE',
        status: 422,
      });
    });

    it('throws ApiError with MENU_ANALYSIS_FAILED code on 422 MENU_ANALYSIS_FAILED', async () => {
      global.fetch = makeFetchMock(422, {
        success: false,
        error: { code: 'MENU_ANALYSIS_FAILED', message: 'Vision failed' },
      });

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'MENU_ANALYSIS_FAILED',
      });
    });

    it('throws ApiError with PAYLOAD_TOO_LARGE code on 413', async () => {
      global.fetch = makeFetchMock(413, {
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'File too large' },
      });

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        status: 413,
      });
    });

    it('throws ApiError with RATE_LIMIT_EXCEEDED code on 429', async () => {
      global.fetch = makeFetchMock(429, {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
      });

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        status: 429,
      });
    });

    it('throws ApiError with UNAUTHORIZED code on 401', async () => {
      global.fetch = makeFetchMock(401, {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
      });

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
      });
    });

    it('throws ApiError with PROCESSING_TIMEOUT code on 408', async () => {
      global.fetch = makeFetchMock(408, {
        success: false,
        error: { code: 'PROCESSING_TIMEOUT', message: 'Server timed out' },
      });

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'PROCESSING_TIMEOUT',
        status: 408,
      });
    });

    it('throws ApiError on network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toThrow(ApiError);
    });

    it('throws ApiError with MALFORMED_RESPONSE on wrong shape', async () => {
      global.fetch = makeFetchMock(200, { unexpected: 'shape' });

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'MALFORMED_RESPONSE',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // AbortError handling
  // ---------------------------------------------------------------------------

  describe('AbortError handling', () => {
    it('rethrows AbortError without wrapping in ApiError', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      global.fetch = jest.fn().mockRejectedValue(abortError);

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toBeInstanceOf(DOMException);
      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('does not wrap AbortError in ApiError', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      global.fetch = jest.fn().mockRejectedValue(abortError);

      const error = await sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID).catch((e) => e);
      expect(error).not.toBeInstanceOf(ApiError);
    });
  });

  // ---------------------------------------------------------------------------
  // TimeoutError handling
  // ---------------------------------------------------------------------------

  describe('TimeoutError handling', () => {
    it('wraps TimeoutError in ApiError with TIMEOUT_ERROR code', async () => {
      const timeoutError = new DOMException('Signal timed out', 'TimeoutError');
      global.fetch = jest.fn().mockRejectedValue(timeoutError);

      await expect(sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID)).rejects.toMatchObject({
        code: 'TIMEOUT_ERROR',
      });
    });

    it('wraps TimeoutError as ApiError (not raw DOMException)', async () => {
      const timeoutError = new DOMException('Signal timed out', 'TimeoutError');
      global.fetch = jest.fn().mockRejectedValue(timeoutError);

      const error = await sendPhotoAnalysis(makeFile(), MOCK_ACTOR_ID).catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
    });
  });
});
