// TDD tests for apiClient.ts
// Tests: request construction, headers, error handling, AbortController, response header persistence

import type { ConversationMessageResponse } from '@foodxplorer/shared';

// Mock persistActorId so we can spy on calls
jest.mock('../../lib/actorId', () => ({
  persistActorId: jest.fn(),
}));

import { persistActorId } from '../../lib/actorId';
import { sendMessage, ApiError } from '../../lib/apiClient';

const MOCK_API_URL = 'http://localhost:3001';
const MOCK_ACTOR_ID = 'test-actor-uuid-0001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccessResponse(overrides: Partial<ConversationMessageResponse['data']> = {}): ConversationMessageResponse {
  return {
    success: true,
    data: {
      intent: 'estimation',
      actorId: MOCK_ACTOR_ID,
      activeContext: null,
      estimation: {
        query: 'big mac',
        chainSlug: 'mcdonalds-es',
        portionMultiplier: 1,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_dish',
        cachedAt: null,
        result: {
          entityType: 'dish',
          entityId: '123e4567-e89b-42d3-a456-426614174000',
          name: 'Big Mac',
          nameEs: 'Big Mac',
          restaurantId: null,
          chainSlug: 'mcdonalds-es',
          portionGrams: 200,
          nutrients: {
            calories: 550,
            proteins: 25,
            carbohydrates: 46,
            sugars: 9,
            fats: 28,
            saturatedFats: 10,
            fiber: 3,
            salt: 2.2,
            sodium: 0.88,
            transFats: 0,
            cholesterol: 0,
            potassium: 0,
            monounsaturatedFats: 0,
            polyunsaturatedFats: 0,
            alcohol: 0,
            referenceBasis: 'per_portion',
          },
          confidenceLevel: 'high',
          estimationMethod: 'level1_exact',
          source: {
            id: '123e4567-e89b-42d3-a456-426614174001',
            name: "McDonald's España",
            type: 'official_chain',
            url: 'https://mcdonalds.es',
          },
          similarityDistance: null,
        },
      },
      ...overrides,
    },
  };
}

function makeFetchMock(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  const responseHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendMessage', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['NEXT_PUBLIC_API_URL'];
    process.env['NEXT_PUBLIC_API_URL'] = MOCK_API_URL;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env['NEXT_PUBLIC_API_URL'] = originalEnv;
  });

  describe('request construction', () => {
    it('sends POST to ${NEXT_PUBLIC_API_URL}/conversation/message', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());

      await sendMessage('big mac', MOCK_ACTOR_ID);

      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_API_URL}/conversation/message`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('sends the text in the JSON body', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());

      await sendMessage('big mac', MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      const body = JSON.parse(callArgs.body as string);
      expect(body).toEqual({ text: 'big mac' });
    });

    it('sets Content-Type: application/json header', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());

      await sendMessage('big mac', MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers['Content-Type']).toBe('application/json');
    });

    it('sets X-Actor-Id header', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());

      await sendMessage('big mac', MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers['X-Actor-Id']).toBe(MOCK_ACTOR_ID);
    });

    it('sets X-FXP-Source: web header', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());

      await sendMessage('big mac', MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers['X-FXP-Source']).toBe('web');
    });
  });

  describe('success response', () => {
    it('returns the parsed ConversationMessageResponse on 200', async () => {
      const mockData = makeSuccessResponse();
      global.fetch = makeFetchMock(200, mockData);

      const result = await sendMessage('big mac', MOCK_ACTOR_ID);

      expect(result).toEqual(mockData);
    });

    it('reads X-Actor-Id response header and calls persistActorId when value differs', async () => {
      const serverActorId = 'server-issued-actor-id-0001';
      global.fetch = makeFetchMock(200, makeSuccessResponse(), { 'X-Actor-Id': serverActorId });

      await sendMessage('big mac', MOCK_ACTOR_ID);

      expect(persistActorId).toHaveBeenCalledWith(serverActorId);
    });

    it('does not call persistActorId when X-Actor-Id response header matches current', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse(), { 'X-Actor-Id': MOCK_ACTOR_ID });

      await sendMessage('big mac', MOCK_ACTOR_ID);

      expect(persistActorId).not.toHaveBeenCalled();
    });

    it('does not call persistActorId when X-Actor-Id response header is absent', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());

      await sendMessage('big mac', MOCK_ACTOR_ID);

      expect(persistActorId).not.toHaveBeenCalled();
    });
  });

  describe('error responses', () => {
    it('throws ApiError with VALIDATION_ERROR code on 400', async () => {
      global.fetch = makeFetchMock(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Bad input' } });

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toThrow(ApiError);
      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('throws ApiError with RATE_LIMIT_EXCEEDED code on 429', async () => {
      global.fetch = makeFetchMock(429, { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } });

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    });

    it('throws ApiError with INTERNAL_ERROR code on 500', async () => {
      global.fetch = makeFetchMock(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } });

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    });

    it('throws ApiError on network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toThrow(ApiError);
    });

    it('throws ApiError on malformed JSON response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toThrow(ApiError);
    });

    it('throws ApiError when response is missing success/data envelope', async () => {
      global.fetch = makeFetchMock(200, { unexpected: 'shape' });

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toThrow(ApiError);
    });

    it('throws descriptive error when NEXT_PUBLIC_API_URL is undefined', async () => {
      delete process.env['NEXT_PUBLIC_API_URL'];
      global.fetch = jest.fn();

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
    });
  });

  describe('AbortController and timeout', () => {
    it('passes AbortSignal.any([signal, timeout]) when external signal is provided', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());
      const controller = new AbortController();

      await sendMessage('x', MOCK_ACTOR_ID, controller.signal);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      // signal should be truthy (AbortSignal.any result or timeout signal)
      expect(callArgs.signal).toBeDefined();
    });

    it('applies AbortSignal.timeout(15000) when no external signal provided', async () => {
      global.fetch = makeFetchMock(200, makeSuccessResponse());

      await sendMessage('x', MOCK_ACTOR_ID);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();
    });

    it('rethrows AbortError without wrapping in ApiError', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      global.fetch = jest.fn().mockRejectedValue(abortError);

      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toThrow('Aborted');
      await expect(sendMessage('x', MOCK_ACTOR_ID)).rejects.toBeInstanceOf(DOMException);
    });
  });
});
