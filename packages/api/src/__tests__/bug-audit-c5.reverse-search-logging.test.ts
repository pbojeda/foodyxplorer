// BUG-AUDIT-C5 — Verify that reverse search DB failures are logged (not silently swallowed).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../conversation/contextManager.js', () => ({
  getContext: vi.fn(),
  setContext: vi.fn(),
}));
vi.mock('../estimation/reverseSearch.js', () => ({
  reverseSearchDishes: vi.fn(),
}));
vi.mock('../conversation/chainResolver.js', () => ({
  resolveChain: vi.fn(),
  loadChainData: vi.fn(),
}));

import { processMessage } from '../conversation/conversationCore.js';
import type { ConversationRequest } from '../conversation/conversationCore.js';
import { getContext } from '../conversation/contextManager.js';
import { reverseSearchDishes } from '../estimation/reverseSearch.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function buildReq(text: string): ConversationRequest {
  return {
    text,
    actorId: '00000000-0000-0000-0000-000000000001',
    db: {} as never,
    redis: {} as never,
    chainSlugs: ['burger-king'],
    chains: [{ chainSlug: 'burger-king', name: 'Burger King', nameEs: null }],
    logger: mockLogger,
  };
}

describe('C5: reverse search DB failure logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getContext).mockResolvedValue({
      chainSlug: 'burger-king',
      chainName: 'Burger King',
    });
  });

  it('logs the error when reverseSearchDishes throws', async () => {
    const dbError = new Error('DB connection refused');
    vi.mocked(reverseSearchDishes).mockRejectedValueOnce(dbError);

    const result = await processMessage(buildReq('qué como con 600 kcal'));

    expect(result.intent).toBe('reverse_search');
    expect(result.reverseSearch).toBeUndefined();
    // The error MUST be logged — not silently swallowed
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: dbError }),
      expect.stringContaining('reverse'),
    );
  });

  it('returns data normally when reverseSearchDishes succeeds', async () => {
    vi.mocked(reverseSearchDishes).mockResolvedValueOnce({
      chainSlug: 'burger-king',
      chainName: 'Burger King',
      maxCalories: 600,
      minProtein: null,
      results: [{ name: 'Salad', nameEs: 'Ensalada', calories: 200, proteins: 10, fats: 5, carbohydrates: 20, portionGrams: 150, proteinDensity: 5 }],
      totalMatches: 1,
    });

    const result = await processMessage(buildReq('qué como con 600 kcal'));

    expect(result.intent).toBe('reverse_search');
    expect(result.reverseSearch).toBeDefined();
    expect(result.reverseSearch?.results).toHaveLength(1);
    // No error logged
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
