// F075 — Unit tests for callWhisperTranscription and isWhisperHallucination in openaiClient.ts
//
// Tests the new Whisper transcription function independently from chat completions.
// OpenAI client is mocked via vi.hoisted + vi.mock to intercept audio.transcriptions.create.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock OpenAI
// ---------------------------------------------------------------------------

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    audio: {
      transcriptions: {
        create: mockCreate,
      },
    },
  })),
}));

// Mock the embeddings client (imported by openaiClient but not relevant here)
vi.mock('../embeddings/embeddingClient.js', () => ({
  callOpenAIEmbeddings: vi.fn(),
}));

import { callWhisperTranscription, isWhisperHallucination, WHISPER_HALLUCINATIONS, mimeTypeToFilename } from '../lib/openaiClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_API_KEY = 'sk-test-key-1234';
const FAKE_AUDIO_BUFFER = Buffer.from('fake audio bytes');
const FAKE_MIME_TYPE = 'audio/ogg';

function makeTranscriptionResponse(text: string) {
  return { text };
}

// ---------------------------------------------------------------------------
// Tests: callWhisperTranscription
// ---------------------------------------------------------------------------

describe('callWhisperTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the transcription text string on success', async () => {
    mockCreate.mockResolvedValue(makeTranscriptionResponse('dos pinchos de tortilla'));

    const result = await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE);

    expect(result).toBe('dos pinchos de tortilla');
  });

  it('calls audio.transcriptions.create with correct parameters', async () => {
    mockCreate.mockResolvedValue(makeTranscriptionResponse('text'));

    await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['model']).toBe('whisper-1');
    expect(callArgs?.['language']).toBe('es');
    expect(callArgs?.['temperature']).toBe(0);
    // File should be constructed from the buffer with the correct mime type
    const file = callArgs?.['file'] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe(FAKE_MIME_TYPE);
    // filename must be derived from MIME type — not hardcoded 'audio.ogg' (F091 AC19)
    expect(file.name).toBe('audio.ogg');
  });

  it('returns null immediately when apiKey is undefined (no API call)', async () => {
    const result = await callWhisperTranscription(undefined, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE);

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null immediately when apiKey is empty string (no API call)', async () => {
    const result = await callWhisperTranscription('', FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE);

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null on non-retryable error (status 400) — single attempt', async () => {
    const err = Object.assign(new Error('Bad request'), { status: 400 });
    mockCreate.mockRejectedValue(err);

    const result = await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE);

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns null after retrying once on 429 — 2 attempts total', async () => {
    const err = Object.assign(new Error('Rate limit'), { status: 429 });
    mockCreate.mockRejectedValue(err);

    const result = await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE);

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('succeeds on second attempt after a 503 first attempt', async () => {
    const serverError = Object.assign(new Error('Service unavailable'), { status: 503 });
    mockCreate
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(makeTranscriptionResponse('success transcription'));

    const result = await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE);

    expect(result).toBe('success transcription');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('calls logger.warn when apiKey is falsy', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await callWhisperTranscription(undefined, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE, logger);

    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('calls logger.warn on failure (non-retryable)', async () => {
    const err = Object.assign(new Error('Bad request'), { status: 400 });
    mockCreate.mockRejectedValue(err);
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('calls logger.info with audioTranscriptionMs on success', async () => {
    mockCreate.mockResolvedValue(makeTranscriptionResponse('text'));
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, FAKE_MIME_TYPE, logger);

    expect(logger.info).toHaveBeenCalledOnce();
    const logCall = logger.info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof logCall?.['audioTranscriptionMs']).toBe('number');
  });

  it('derives filename audio.webm when mimeType is audio/webm (F091 AC19)', async () => {
    mockCreate.mockResolvedValue(makeTranscriptionResponse('text'));

    await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, 'audio/webm');

    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    const file = callArgs?.['file'] as File;
    expect(file.name).toBe('audio.webm');
  });

  it('derives filename audio.mp4 when mimeType is audio/mp4 (F091 AC19)', async () => {
    mockCreate.mockResolvedValue(makeTranscriptionResponse('text'));

    await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, 'audio/mp4');

    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    const file = callArgs?.['file'] as File;
    expect(file.name).toBe('audio.mp4');
  });

  it('derives filename audio.mp3 when mimeType is audio/mpeg (F091 AC19)', async () => {
    mockCreate.mockResolvedValue(makeTranscriptionResponse('text'));

    await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, 'audio/mpeg');

    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    const file = callArgs?.['file'] as File;
    expect(file.name).toBe('audio.mp3');
  });

  it('derives filename audio.webm when mimeType has codec param (audio/webm;codecs=opus) (F091 AC19)', async () => {
    mockCreate.mockResolvedValue(makeTranscriptionResponse('text'));

    await callWhisperTranscription(FAKE_API_KEY, FAKE_AUDIO_BUFFER, 'audio/webm;codecs=opus');

    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    const file = callArgs?.['file'] as File;
    expect(file.name).toBe('audio.webm');
  });
});

// ---------------------------------------------------------------------------
// Tests: isWhisperHallucination
// ---------------------------------------------------------------------------

describe('isWhisperHallucination', () => {
  it('returns true for exact match of known hallucination string', () => {
    expect(isWhisperHallucination('Subtítulos por la comunidad de Amara.org')).toBe(true);
  });

  it('returns true for trimmed match (leading/trailing whitespace)', () => {
    expect(isWhisperHallucination('  Gracias por ver el vídeo  ')).toBe(true);
  });

  it('returns true for match with trailing punctuation (period stripped)', () => {
    expect(isWhisperHallucination('Thanks for watching.')).toBe(true);
  });

  it('returns true for match with trailing exclamation mark (stripped)', () => {
    expect(isWhisperHallucination('Thank you for watching!')).toBe(true);
  });

  it('returns false for legitimate transcription text', () => {
    expect(isWhisperHallucination('me he comido dos pinchos de tortilla y una caña')).toBe(false);
  });

  it('returns false for empty string (empty handled separately by EMPTY_TRANSCRIPTION)', () => {
    expect(isWhisperHallucination('')).toBe(false);
  });

  it('returns true for all 8 hallucination strings in the set', () => {
    const hallucinations = [
      'Subtítulos por la comunidad de Amara.org',
      'Subtítulos realizados por la comunidad de Amara.org',
      'Gracias por ver el vídeo',
      'Suscríbete al canal',
      'Música de fondo',
      'Gracias por ver',
      'Thanks for watching',
      'Thank you for watching',
    ];
    for (const h of hallucinations) {
      expect(isWhisperHallucination(h)).toBe(true);
    }
  });

  it('WHISPER_HALLUCINATIONS set contains exactly 8 entries', () => {
    expect(WHISPER_HALLUCINATIONS.size).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Tests: mimeTypeToFilename (F091 AC19)
// ---------------------------------------------------------------------------

describe('mimeTypeToFilename', () => {
  it('maps audio/ogg → audio.ogg', () => {
    expect(mimeTypeToFilename('audio/ogg')).toBe('audio.ogg');
  });

  it('maps audio/webm → audio.webm', () => {
    expect(mimeTypeToFilename('audio/webm')).toBe('audio.webm');
  });

  it('maps audio/mp4 → audio.mp4', () => {
    expect(mimeTypeToFilename('audio/mp4')).toBe('audio.mp4');
  });

  it('maps audio/mpeg → audio.mp3', () => {
    expect(mimeTypeToFilename('audio/mpeg')).toBe('audio.mp3');
  });

  it('maps audio/webm;codecs=opus → audio.webm (strips codec parameter)', () => {
    expect(mimeTypeToFilename('audio/webm;codecs=opus')).toBe('audio.webm');
  });

  it('maps audio/ogg; codecs=opus → audio.ogg (strips codec parameter with space)', () => {
    expect(mimeTypeToFilename('audio/ogg; codecs=opus')).toBe('audio.ogg');
  });

  it('maps unknown MIME type → audio.bin (fallback)', () => {
    expect(mimeTypeToFilename('audio/x-custom')).toBe('audio.bin');
  });

  it('maps empty string → audio.bin (fallback)', () => {
    expect(mimeTypeToFilename('')).toBe('audio.bin');
  });
});
