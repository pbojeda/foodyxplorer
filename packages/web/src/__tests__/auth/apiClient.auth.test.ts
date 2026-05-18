// F107a: Tests for setAuthToken + Bearer header injection in apiClient.
// AC: setAuthToken exported; bearer injected when token set; removed when null;
//     X-Actor-Id and X-FXP-Source unchanged in both cases.

// NOTE: We import setAuthToken and the functions under test AFTER jest.spyOn/mock setup.
// Module-level `authToken` state persists across tests — reset via setAuthToken(null)
// in beforeEach.

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Provide NEXT_PUBLIC_API_URL for sendMessage / sendVoiceMessage
process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

// Minimal success response shape
const makeSuccessResponse = (body: object) =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response);

const conversationSuccessBody = {
  success: true,
  data: {
    intent: 'estimation',
    actorId: 'actor-uuid',
    activeContext: null,
    estimation: {
      query: 'test',
      chainSlug: null,
      portionMultiplier: 1,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      cachedAt: null,
      result: {
        entityType: 'dish',
        entityId: '00000000-0000-4000-a000-000000000001',
        name: 'Test',
        nameEs: 'Test',
        restaurantId: null,
        chainSlug: null,
        portionGrams: 100,
        nutrients: {
          calories: 100, proteins: 10, carbohydrates: 20, sugars: 5,
          fats: 5, saturatedFats: 2, fiber: 1, salt: 0.5, sodium: 0.2,
          transFats: 0, cholesterol: 0, potassium: 0,
          monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
          referenceBasis: 'per_portion',
        },
        confidenceLevel: 'high',
        estimationMethod: 'level1_exact',
        source: { id: '00000000-0000-4000-a000-000000000002', name: 'Test', type: 'official_chain', url: 'https://test.com' },
        similarityDistance: null,
      },
    },
  },
};

describe('apiClient — setAuthToken (F107a)', () => {
  let setAuthToken: (token: string | null) => void;
  let sendMessage: typeof import('../../lib/apiClient').sendMessage;
  let sendVoiceMessage: typeof import('../../lib/apiClient').sendVoiceMessage;

  beforeEach(() => {
    jest.resetModules();
    /* eslint-disable */
    const apiClient = require('../../lib/apiClient');
    /* eslint-enable */
    setAuthToken = apiClient.setAuthToken;
    sendMessage = apiClient.sendMessage;
    sendVoiceMessage = apiClient.sendVoiceMessage;
    mockFetch.mockClear();
    setAuthToken(null);
  });

  it('exports setAuthToken as a function', () => {
    expect(typeof setAuthToken).toBe('function');
  });

  describe('sendMessage bearer injection', () => {
    it('does NOT include Authorization header when authToken is null', async () => {
      mockFetch.mockReturnValueOnce(makeSuccessResponse(conversationSuccessBody));
      await sendMessage('test query', 'actor-uuid');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('includes Authorization: Bearer <token> when authToken is set', async () => {
      setAuthToken('my-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(conversationSuccessBody));
      await sendMessage('test query', 'actor-uuid');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-jwt-token');
    });

    it('removes Authorization header after setAuthToken(null)', async () => {
      setAuthToken('my-jwt-token');
      setAuthToken(null);
      mockFetch.mockReturnValueOnce(makeSuccessResponse(conversationSuccessBody));
      await sendMessage('test query', 'actor-uuid');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('X-Actor-Id and X-FXP-Source headers are present regardless of auth state', async () => {
      setAuthToken('my-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(conversationSuccessBody));
      await sendMessage('test query', 'test-actor-id');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Actor-Id']).toBe('test-actor-id');
      expect(headers['X-FXP-Source']).toBe('web');
    });
  });

  describe('sendVoiceMessage bearer injection', () => {
    it('does NOT include Authorization header when authToken is null', async () => {
      mockFetch.mockReturnValueOnce(makeSuccessResponse(conversationSuccessBody));
      await sendVoiceMessage(new Blob(['data'], { type: 'audio/webm' }), 'audio/webm', 2, 'actor-uuid');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('includes Authorization: Bearer <token> in sendVoiceMessage when token set', async () => {
      setAuthToken('voice-jwt-token');
      mockFetch.mockReturnValueOnce(makeSuccessResponse(conversationSuccessBody));
      await sendVoiceMessage(new Blob(['data'], { type: 'audio/webm' }), 'audio/webm', 2, 'actor-uuid');
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer voice-jwt-token');
    });
  });
});
