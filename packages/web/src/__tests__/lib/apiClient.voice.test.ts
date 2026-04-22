// Unit tests for sendVoiceMessage — F091
// Mirrors apiClient.photo.test.ts pattern.
// Mocks global.fetch directly; no module-level mocks needed (actorId is a param).

import { sendVoiceMessage, ApiError } from '@/lib/apiClient';
import { createVoiceConversationResponse } from '../fixtures';

// Ensure NEXT_PUBLIC_API_URL is available
const API_URL = 'https://api.example.com';

beforeEach(() => {
  process.env['NEXT_PUBLIC_API_URL'] = API_URL;
  jest.resetAllMocks();
  // Reset speak mock from jest.setup.ts
  (global.speechSynthesis.speak as jest.Mock).mockClear();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown): void {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn(() => null) },
    json: jest.fn().mockResolvedValueOnce(body),
  } as unknown as Response);
}

function mockFetchNetworkError(): void {
  global.fetch = jest.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));
}

const ACTOR_ID = '00000000-0000-4000-a000-000000000099';

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

describe('sendVoiceMessage — success', () => {
  it('returns parsed ConversationMessageResponse on 200', async () => {
    const expected = createVoiceConversationResponse();
    mockFetch(200, expected);

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const result = await sendVoiceMessage(blob, 'audio/webm', 3.5, ACTOR_ID);

    expect(result).toEqual(expected);
  });

  it('sends FormData with audio blob and duration fields', async () => {
    const expected = createVoiceConversationResponse();
    mockFetch(200, expected);

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await sendVoiceMessage(blob, 'audio/webm', 5.0, ACTOR_ID);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const [_url, init] = fetchCall as [string, RequestInit];
    const formData = init.body as FormData;

    expect(formData.get('audio')).toBeTruthy();
    expect(formData.get('duration')).toBe('5');
  });

  it('sets X-Actor-Id and X-FXP-Source: web headers', async () => {
    mockFetch(200, createVoiceConversationResponse());

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await sendVoiceMessage(blob, 'audio/webm', 2.0, ACTOR_ID);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const [_url, init] = fetchCall as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers['X-Actor-Id']).toBe(ACTOR_ID);
    expect(headers['X-FXP-Source']).toBe('web');
  });

  it('does NOT include X-API-Key header', async () => {
    mockFetch(200, createVoiceConversationResponse());

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await sendVoiceMessage(blob, 'audio/webm', 2.0, ACTOR_ID);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const [_url, init] = fetchCall as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers['X-API-Key']).toBeUndefined();
  });

  it('calls the correct URL: NEXT_PUBLIC_API_URL/conversation/audio', async () => {
    mockFetch(200, createVoiceConversationResponse());

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await sendVoiceMessage(blob, 'audio/webm', 2.0, ACTOR_ID);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const [url] = fetchCall as [string];
    expect(url).toBe(`${API_URL}/conversation/audio`);
  });

  it('derives filename from MIME type: audio/webm;codecs=opus → audio.webm', async () => {
    mockFetch(200, createVoiceConversationResponse());

    const blob = new Blob(['audio'], { type: 'audio/webm;codecs=opus' });
    await sendVoiceMessage(blob, 'audio/webm;codecs=opus', 2.0, ACTOR_ID);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const [_url, init] = fetchCall as [string, RequestInit];
    const formData = init.body as FormData;
    const audioField = formData.get('audio') as File;

    expect(audioField).toBeTruthy();
    // File name should be audio.webm (derived from mime type base)
    if (audioField instanceof File) {
      expect(audioField.name).toBe('audio.webm');
    }
  });
});

// ---------------------------------------------------------------------------
// 422 errors
// ---------------------------------------------------------------------------

describe('sendVoiceMessage — 422 errors', () => {
  it('throws ApiError with code EMPTY_TRANSCRIPTION on 422', async () => {
    mockFetch(422, {
      success: false,
      error: { code: 'EMPTY_TRANSCRIPTION', message: 'No speech detected' },
    });

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(sendVoiceMessage(blob, 'audio/webm', 1.0, ACTOR_ID)).rejects.toMatchObject({
      code: 'EMPTY_TRANSCRIPTION',
      status: 422,
    });
  });

  it('throws ApiError with code TRANSCRIPTION_FAILED on 422 with that code', async () => {
    mockFetch(422, {
      success: false,
      error: { code: 'TRANSCRIPTION_FAILED', message: 'Whisper error' },
    });

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(sendVoiceMessage(blob, 'audio/webm', 1.0, ACTOR_ID)).rejects.toMatchObject({
      code: 'TRANSCRIPTION_FAILED',
      status: 422,
    });
  });
});

// ---------------------------------------------------------------------------
// 429 errors (rate limit)
// ---------------------------------------------------------------------------

describe('sendVoiceMessage — 429 errors', () => {
  it('throws ApiError with RATE_LIMIT_EXCEEDED and preserves details.bucket on 429', async () => {
    mockFetch(429, {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
        details: { bucket: 'voice', tier: 'free', limit: 30, resetAt: '2026-04-22T00:00:00Z' },
      },
    });

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    let caughtError: ApiError | null = null;
    try {
      await sendVoiceMessage(blob, 'audio/webm', 2.0, ACTOR_ID);
    } catch (e) {
      if (e instanceof ApiError) caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(caughtError?.status).toBe(429);
    expect(caughtError?.details).toEqual({
      bucket: 'voice',
      tier: 'free',
      limit: 30,
      resetAt: '2026-04-22T00:00:00Z',
    });
  });

  it('throws ApiError with IP_VOICE_LIMIT_EXCEEDED on 429 with that code', async () => {
    mockFetch(429, {
      success: false,
      error: {
        code: 'IP_VOICE_LIMIT_EXCEEDED',
        message: 'IP voice limit exceeded',
        details: { limitMinutes: 30, resetAt: '2026-04-22T00:00:00Z' },
      },
    });

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(sendVoiceMessage(blob, 'audio/webm', 2.0, ACTOR_ID)).rejects.toMatchObject({
      code: 'IP_VOICE_LIMIT_EXCEEDED',
      status: 429,
    });
  });
});

// ---------------------------------------------------------------------------
// 502 / 503 errors
// ---------------------------------------------------------------------------

describe('sendVoiceMessage — 5xx errors', () => {
  it('throws ApiError with TRANSCRIPTION_FAILED on 502', async () => {
    mockFetch(502, {
      success: false,
      error: { code: 'TRANSCRIPTION_FAILED', message: 'Whisper returned error' },
    });

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(sendVoiceMessage(blob, 'audio/webm', 3.0, ACTOR_ID)).rejects.toMatchObject({
      code: 'TRANSCRIPTION_FAILED',
      status: 502,
    });
  });

  it('throws ApiError with VOICE_BUDGET_EXHAUSTED on 503', async () => {
    mockFetch(503, {
      success: false,
      error: { code: 'VOICE_BUDGET_EXHAUSTED', message: 'Monthly voice budget exhausted' },
    });

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(sendVoiceMessage(blob, 'audio/webm', 3.0, ACTOR_ID)).rejects.toMatchObject({
      code: 'VOICE_BUDGET_EXHAUSTED',
      status: 503,
    });
  });
});

// ---------------------------------------------------------------------------
// Network failure
// ---------------------------------------------------------------------------

describe('sendVoiceMessage — network failure', () => {
  it('throws ApiError with code NETWORK_ERROR on fetch rejection', async () => {
    mockFetchNetworkError();

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(sendVoiceMessage(blob, 'audio/webm', 2.0, ACTOR_ID)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

// ---------------------------------------------------------------------------
// AbortSignal
// ---------------------------------------------------------------------------

describe('sendVoiceMessage — abort', () => {
  it('re-throws DOMException AbortError when signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();

    global.fetch = jest.fn().mockRejectedValueOnce(
      new DOMException('Aborted', 'AbortError')
    );

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(
      sendVoiceMessage(blob, 'audio/webm', 2.0, ACTOR_ID, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
