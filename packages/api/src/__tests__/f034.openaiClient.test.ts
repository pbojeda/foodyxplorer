// F034 — Unit tests for callVisionCompletion in openaiClient.ts
//
// Tests the new multimodal Vision API function independently from callChatCompletion.
// OpenAI client is mocked via vi.mock.

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
        create: mockCreate,
      },
    },
  })),
}));

// Mock the embeddings client (imported by openaiClient but not relevant here)
vi.mock('../embeddings/embeddingClient.js', () => ({
  callOpenAIEmbeddings: vi.fn(),
}));

import { callVisionCompletion } from '../lib/openaiClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_API_KEY = 'sk-test-key-1234';
const FAKE_BASE64 = Buffer.from('fake image bytes').toString('base64');
const FAKE_MIME = 'image/jpeg';
const FAKE_PROMPT = 'List all dish names in this menu.';

function makeSuccessResponse(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('callVisionCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the content string on success', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('["Burger", "Pizza"]'));

    const result = await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT);

    expect(result).toBe('["Burger", "Pizza"]');
  });

  it('constructs a multimodal message with image_url content', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('[]'));

    await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    const messages = callArgs?.['messages'] as Array<Record<string, unknown>>;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages).toHaveLength(1);

    const userMessage = messages[0];
    expect(userMessage?.['role']).toBe('user');

    const content = userMessage?.['content'] as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);

    // Text part
    const textPart = content[0];
    expect(textPart?.['type']).toBe('text');
    expect(textPart?.['text']).toBe(FAKE_PROMPT);

    // Image URL part
    const imagePart = content[1];
    expect(imagePart?.['type']).toBe('image_url');
    const imageUrl = imagePart?.['image_url'] as Record<string, unknown>;
    expect(imageUrl?.['url']).toBe(`data:${FAKE_MIME};base64,${FAKE_BASE64}`);
  });

  it('uses gpt-4o-mini model by default', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('result'));

    await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT);

    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['model']).toBe('gpt-4o-mini');
  });

  it('passes maxTokens when provided', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('result'));

    await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT, undefined, 2048);

    const callArgs = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs?.['max_tokens']).toBe(2048);
  });

  it('returns null when content is null (empty response)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: null,
    });

    const result = await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT);

    expect(result).toBeNull();
  });

  it('returns null on non-retryable error (does not throw)', async () => {
    const err = Object.assign(new Error('Bad request'), { status: 400 });
    mockCreate.mockRejectedValue(err);

    const result = await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT);

    expect(result).toBeNull();
    // Only 1 attempt — non-retryable errors short-circuit
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on retryable 429 error then returns null after exhaustion', async () => {
    const err = Object.assign(new Error('Rate limit'), { status: 429 });
    mockCreate.mockRejectedValue(err);

    const result = await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT);

    expect(result).toBeNull();
    // 2 attempts total (MAX_RETRIES = 2)
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries once on 503 server error then succeeds on second attempt', async () => {
    const serverError = Object.assign(new Error('Service unavailable'), { status: 503 });
    mockCreate
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(makeSuccessResponse('success'));

    const result = await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT);

    expect(result).toBe('success');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('calls logger.info on success with token usage', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('result'));
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT, logger);

    expect(logger.info).toHaveBeenCalledOnce();
    const logCall = logger.info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logCall?.['promptTokens']).toBe(100);
    expect(logCall?.['completionTokens']).toBe(50);
  });

  it('calls logger.warn on failure (never throws)', async () => {
    mockCreate.mockRejectedValue(new Error('Catastrophic failure'));
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await callVisionCompletion(FAKE_API_KEY, FAKE_BASE64, FAKE_MIME, FAKE_PROMPT, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});
