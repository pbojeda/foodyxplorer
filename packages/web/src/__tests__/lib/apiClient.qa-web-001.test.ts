// QA-WEB-001: API client gap tests.
//
// Areas covered:
//   sendMessage — MALFORMED_RESPONSE when data is null
//   sendMessage — PARSE_ERROR when response.json() throws
//   actor ID persistence: called when response header differs
//   actor ID persistence: NOT called when header matches
//   BUG-QA-011 probe — actor ID persisted BEFORE body validation
//   sendPhotoAnalysis — MALFORMED_RESPONSE when data is null
//   sendPhotoAnalysis — error code extraction from structured error body
//   sendPhotoAnalysis — unknown error shape falls back to API_ERROR

// Mock persistActorId so we can spy on calls
jest.mock('../../lib/actorId', () => ({
  persistActorId: jest.fn(),
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
}));

import { persistActorId } from '../../lib/actorId';
import { sendMessage, sendPhotoAnalysis, ApiError } from '../../lib/apiClient';

const mockPersistActorId = persistActorId as jest.Mock;

const MOCK_API_URL = 'http://localhost:3001';
const MOCK_ACTOR_ID = 'test-actor-uuid-0001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeSuccessConversationResponse() {
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

function makeSuccessMenuResponse() {
  return {
    success: true,
    data: {
      mode: 'identify',
      dishCount: 1,
      dishes: [
        {
          dishName: 'Tortilla española',
          estimate: {
            query: 'tortilla española',
            chainSlug: null,
            portionMultiplier: 1,
            level1Hit: false,
            level2Hit: true,
            level3Hit: false,
            level4Hit: false,
            matchType: 'fuzzy',
            cachedAt: null,
            result: null,
          },
        },
      ],
      partial: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QA-WEB-001 apiClient — sendMessage gaps', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['NEXT_PUBLIC_API_URL'];
    process.env['NEXT_PUBLIC_API_URL'] = MOCK_API_URL;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['NEXT_PUBLIC_API_URL'] = originalEnv;
    } else {
      delete process.env['NEXT_PUBLIC_API_URL'];
    }
  });

  it('does NOT throw for null data — typeof null === "object" passes the guard', async () => {
    // Documents a gap: { success: true, data: null } passes isConversationMessageResponse
    // because typeof null === 'object' in JS. The guard should check data !== null.
    // Current behavior: response returned as-is without MALFORMED_RESPONSE.
    const nullDataBody = { success: true, data: null };
    global.fetch = makeFetchMock(200, nullDataBody);

    // Should NOT throw — guard passes for null data
    const result = await sendMessage('big mac', MOCK_ACTOR_ID);
    expect(result).toEqual({ success: true, data: null });
  });

  it('throws ApiError PARSE_ERROR when response.json() throws SyntaxError', async () => {
    const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: responseHeaders,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      text: jest.fn().mockResolvedValue('not json'),
    });

    await expect(sendMessage('big mac', MOCK_ACTOR_ID)).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    });
  });

  it('calls persistActorId when response X-Actor-Id header differs from sent actorId', async () => {
    const newActorId = 'new-server-assigned-actor-id';
    global.fetch = makeFetchMock(200, makeSuccessConversationResponse(), {
      'X-Actor-Id': newActorId,
    });

    await sendMessage('big mac', MOCK_ACTOR_ID);

    expect(mockPersistActorId).toHaveBeenCalledWith(newActorId);
    expect(mockPersistActorId).toHaveBeenCalledTimes(1);
  });

  it('does NOT call persistActorId when X-Actor-Id header matches sent actorId', async () => {
    // Same actor ID sent and received → no persistence call
    global.fetch = makeFetchMock(200, makeSuccessConversationResponse(), {
      'X-Actor-Id': MOCK_ACTOR_ID, // same as what was sent
    });

    await sendMessage('big mac', MOCK_ACTOR_ID);

    expect(mockPersistActorId).not.toHaveBeenCalled();
  });

  it('documents BUG-QA-011: actor ID is persisted BEFORE body validation completes', async () => {
    // Documents BUG-QA-011 probe — actor ID persistence happens at apiClient.ts:121
    // BEFORE the json() call at line 127 and isConversationMessageResponse guard at line 143.
    // If json() throws, persistActorId has already been called.
    const newActorId = 'pre-validation-actor-id';
    const responseHeaders = new Headers({ 'X-Actor-Id': newActorId });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: responseHeaders,
      // json() throws — body is invalid
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      text: jest.fn().mockResolvedValue('not json'),
    });

    // This should throw (PARSE_ERROR) but persistActorId was already called
    await expect(sendMessage('big mac', MOCK_ACTOR_ID)).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    });

    // BUG-QA-011 confirmed: persistActorId called even though body parsing failed
    expect(mockPersistActorId).toHaveBeenCalledWith(newActorId);
  });
});

// ---------------------------------------------------------------------------
// sendPhotoAnalysis gaps
// ---------------------------------------------------------------------------

describe('QA-WEB-001 apiClient — sendPhotoAnalysis gaps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT throw for null data — typeof null === "object" passes the guard', async () => {
    // Same as sendMessage: { success: true, data: null } passes isMenuAnalysisResponse
    // because typeof null === 'object'. Guard should check data !== null.
    const nullDataBody = { success: true, data: null };
    global.fetch = makeFetchMock(200, nullDataBody);

    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });
    const result = await sendPhotoAnalysis(file, MOCK_ACTOR_ID);
    expect(result).toEqual({ success: true, data: null });
  });

  it('extracts structured error code from { error: { code, message } } body', async () => {
    global.fetch = makeFetchMock(422, {
      error: { code: 'MENU_ANALYSIS_FAILED', message: 'Vision failed' },
    });

    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(sendPhotoAnalysis(file, MOCK_ACTOR_ID)).rejects.toMatchObject({
      code: 'MENU_ANALYSIS_FAILED',
      status: 422,
    });
  });

  it('falls back to API_ERROR code when error body is a plain string', async () => {
    // Route handler returns { error: 'CONFIG_ERROR' } (string, not object) — BUG-QA-003
    global.fetch = makeFetchMock(500, { error: 'SOME_STRING' });

    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(sendPhotoAnalysis(file, MOCK_ACTOR_ID)).rejects.toMatchObject({
      code: 'API_ERROR',
    });
  });
});
