import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationRequest } from '../conversation/types.js';

// Mock dependencies BEFORE importing processMessage
vi.mock('../conversation/contextManager.js', () => ({
  getContext: vi.fn(),
  setContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../conversation/chainResolver.js', () => ({
  resolveChain: vi.fn().mockReturnValue(null),
}));

vi.mock('../conversation/estimationOrchestrator.js', () => ({
  estimate: vi.fn().mockResolvedValue({
    query: 'test',
    chainSlug: null,
    level1Hit: false,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: null,
    result: null,
    cachedAt: null,
    portionMultiplier: 1,
  }),
}));

vi.mock('../conversation/menuDetector.js', () => ({
  detectMenuQuery: vi.fn().mockReturnValue(null),
}));

vi.mock('../estimation/reverseSearch.js', () => ({
  reverseSearchDishes: vi.fn(),
}));

import { processMessage } from '../conversation/conversationCore.js';
import { getContext } from '../conversation/contextManager.js';
import { reverseSearchDishes } from '../estimation/reverseSearch.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
};

function buildRequest(text: string): ConversationRequest {
  return {
    text,
    actorId: '00000000-0000-0000-0000-000000000001',
    db: {} as never,
    redis: {} as never,
    chainSlugs: ['burger-king', 'mcdonalds'],
    chains: [
      { chainSlug: 'burger-king', name: 'Burger King', nameEs: null },
      { chainSlug: 'mcdonalds', name: "McDonald's", nameEs: null },
    ],
    logger: mockLogger,
  };
}

const defaultReverseSearchResult = {
  chainSlug: 'burger-king',
  chainName: 'Burger King',
  maxCalories: 600,
  minProtein: null,
  results: [
    {
      name: 'Whopper Jr',
      nameEs: null,
      calories: 310,
      proteins: 16,
      fats: 18,
      carbohydrates: 27,
      portionGrams: 150,
      proteinDensity: 5.16,
    },
  ],
  totalMatches: 1,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processMessage — reverse_search intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getContext).mockResolvedValue({ chainSlug: 'burger-king', chainName: 'Burger King' });
    vi.mocked(reverseSearchDishes).mockResolvedValue(defaultReverseSearchResult);
  });

  it('detects reverse_search with chain context and returns results', async () => {
    const result = await processMessage(buildRequest('qué como con 600 kcal'));

    expect(result.intent).toBe('reverse_search');
    expect(result.reverseSearch).toBeDefined();
    expect(result.reverseSearch!.chainSlug).toBe('burger-king');
    expect(result.reverseSearch!.results).toHaveLength(1);
  });

  it('detects reverse_search with protein constraint', async () => {
    vi.mocked(reverseSearchDishes).mockResolvedValueOnce({
      ...defaultReverseSearchResult,
      minProtein: 30,
      results: [],
      totalMatches: 0,
    });

    const result = await processMessage(
      buildRequest('qué como con 600 kcal necesito 30g proteína'),
    );

    expect(result.intent).toBe('reverse_search');
    expect(reverseSearchDishes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chainSlug: 'burger-king',
        maxCalories: 600,
        minProtein: 30,
      }),
    );
  });

  it('returns reverse_search intent without data when no chain context', async () => {
    vi.mocked(getContext).mockResolvedValueOnce(null);

    const result = await processMessage(buildRequest('qué como con 600 kcal'));

    expect(result.intent).toBe('reverse_search');
    expect(result.reverseSearch).toBeUndefined();
  });

  it('does not trigger for normal food queries', async () => {
    const result = await processMessage(buildRequest('big mac'));

    expect(result.intent).toBe('estimation');
  });
});
