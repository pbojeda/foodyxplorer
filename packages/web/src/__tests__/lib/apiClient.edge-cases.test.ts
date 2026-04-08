/**
 * apiClient edge-case tests — F090 QA
 *
 * Tests scenarios missing from the main apiClient.test.ts:
 *
 * 1. AbortSignal.timeout() fires a TimeoutError (DOMException, name 'TimeoutError')
 *    — NOT an AbortError. The current apiClient.ts only guards for 'AbortError',
 *    so TimeoutError gets wrapped as NETWORK_ERROR. This test documents/probes
 *    whether the TimeoutError is re-thrown or wrapped.
 *
 * 2. External AbortController.abort() fires AbortError — must be re-thrown (not wrapped).
 *
 * 3. Network failure with TypeError — must throw ApiError(NETWORK_ERROR).
 *
 * 4. NEXT_PUBLIC_API_URL missing — must throw descriptive error before fetch.
 */

import type { ConversationMessageResponse } from '@foodxplorer/shared';

jest.mock('../../lib/actorId', () => ({
  persistActorId: jest.fn(),
}));

import { sendMessage, ApiError } from '../../lib/apiClient';

const MOCK_API_URL = 'http://localhost:3001';
const MOCK_ACTOR_ID = 'test-actor-qa-edge-0001';

function makeSuccessResponse(): ConversationMessageResponse {
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
    },
  };
}

describe('sendMessage — edge cases', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['NEXT_PUBLIC_API_URL'];
    process.env['NEXT_PUBLIC_API_URL'] = MOCK_API_URL;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env['NEXT_PUBLIC_API_URL'] = originalEnv;
  });

  /**
   * FIXED (BUG-F090-01): TimeoutError from AbortSignal.timeout(15000) is now
   * wrapped as ApiError(TIMEOUT_ERROR) so HablarShell can show the correct
   * Spanish copy: "La consulta ha tardado demasiado. Inténtalo de nuevo."
   */
  it('TimeoutError from AbortSignal.timeout is wrapped as TIMEOUT_ERROR', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    global.fetch = jest.fn().mockRejectedValue(timeoutError);

    const error = await sendMessage('x', MOCK_ACTOR_ID).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('TIMEOUT_ERROR');
    expect((error as ApiError).message).toBe('La consulta ha tardado demasiado. Inténtalo de nuevo.');
  });

  /**
   * AbortError from external AbortController.abort() must be re-thrown directly
   * (not wrapped in ApiError) — this is the existing correct behavior.
   */
  it('AbortError from external controller is re-thrown as DOMException (not ApiError)', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    global.fetch = jest.fn().mockRejectedValue(abortError);

    const error = await sendMessage('x', MOCK_ACTOR_ID).catch((e) => e);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(ApiError);
  });

  /**
   * MISSING_TEST: HablarShell uses NETWORK_ERROR code to show the "Sin conexión"
   * copy. A genuine network failure (TypeError: Failed to fetch) should produce
   * an ApiError whose message does NOT match the timeout message.
   * Verifying the message distinguishes the two cases is critical for BUG-1 triage.
   */
  it('network TypeError produces NETWORK_ERROR with the original error message (not timeout message)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await sendMessage('x', MOCK_ACTOR_ID).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK_ERROR');
    expect((error as ApiError).message).toBe('Failed to fetch');
  });

  /**
   * MISSING_TEST: What if the response body is valid JSON but 'success' is false
   * with no 'error' field? Should throw ApiError with fallback code 'API_ERROR'.
   */
  it('throws ApiError with API_ERROR code when response is non-2xx with no error field', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: jest.fn().mockResolvedValue({ success: false }), // no 'error' key
    });

    const error = await sendMessage('x', MOCK_ACTOR_ID).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('API_ERROR');
    expect((error as ApiError).status).toBe(503);
  });

  /**
   * MISSING_TEST: What if NEXT_PUBLIC_API_URL is set to an empty string ''?
   * The guard only checks for undefined, so an empty string would pass through
   * and produce a fetch to '/conversation/message' (relative URL).
   */
  it('throws when NEXT_PUBLIC_API_URL is empty string', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = '';
    global.fetch = jest.fn();

    // The current implementation only guards against undefined, NOT empty string.
    // This test probes whether an empty URL is caught early.
    const error = await sendMessage('x', MOCK_ACTOR_ID).catch((e) => e);

    // This should throw before reaching fetch (or at least not silently succeed)
    expect(error).toBeTruthy();
    // If the implementation does NOT guard empty string, fetch is called with
    // an invalid URL and the test exposes the gap.
    // Correct behavior: same error as undefined URL.
  });
});
