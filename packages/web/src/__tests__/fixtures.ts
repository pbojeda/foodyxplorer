// Test data factories for F090 component tests.
// All factories accept optional overrides for fine-grained control.

import type {
  ConversationMessageData,
  ConversationMessageResponse,
  EstimateData,
  EstimateResult,
  ReverseSearchResult,
  ReverseSearchData,
  MenuEstimationData,
  MenuAnalysisDish,
  MenuAnalysisData,
  MenuAnalysisResponse,
} from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// EstimateResult factory
// ---------------------------------------------------------------------------

export function createEstimateResult(
  overrides: Partial<EstimateResult> = {}
): EstimateResult {
  return {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EstimateData factory
// ---------------------------------------------------------------------------

export function createEstimateData(overrides: Partial<EstimateData> = {}): EstimateData {
  // `portionAssumption` (F-UX-B) is an optional field on EstimateData — absent by default
  // so the card renders no <div role="note"> for plain queries. Pass via `overrides` to
  // exercise the portion-assumption render paths in F-UX-B tests.
  return {
    query: 'big mac',
    chainSlug: 'mcdonalds-es',
    portionMultiplier: 1,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish',
    cachedAt: null,
    result: createEstimateResult(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ConversationMessageData factory
// ---------------------------------------------------------------------------

type IntentOverrides = {
  estimation?: EstimateData;
  comparison?: ConversationMessageData['comparison'];
  menuEstimation?: MenuEstimationData;
  reverseSearch?: ReverseSearchData;
  contextSet?: ConversationMessageData['contextSet'];
  ambiguous?: true;
};

export function createConversationMessageData(
  intent: ConversationMessageData['intent'] = 'estimation',
  overrides: Partial<ConversationMessageData> & IntentOverrides = {}
): ConversationMessageData {
  const base: ConversationMessageData = {
    intent,
    actorId: '00000000-0000-4000-a000-000000000001',
    activeContext: null,
  };

  switch (intent) {
    case 'estimation':
      return {
        ...base,
        estimation: overrides.estimation ?? createEstimateData(),
        ...overrides,
      };
    case 'comparison':
      return {
        ...base,
        comparison: overrides.comparison ?? {
          dishA: createEstimateData(),
          dishB: createEstimateData({
            query: 'whopper',
            result: createEstimateResult({ name: 'Whopper', nameEs: 'Whopper', chainSlug: 'burger-king-es' }),
          }),
        },
        ...overrides,
      };
    case 'menu_estimation':
      return {
        ...base,
        menuEstimation: overrides.menuEstimation ?? {
          items: [
            { query: 'big mac', estimation: createEstimateData() },
            { query: 'patatas fritas', estimation: createEstimateData({ query: 'patatas fritas' }) },
          ],
          totals: {
            calories: 1000,
            proteins: 40,
            carbohydrates: 100,
            sugars: 18,
            fats: 50,
            saturatedFats: 15,
            fiber: 6,
            salt: 4,
            sodium: 1.6,
            transFats: 0,
            cholesterol: 0,
            potassium: 0,
            monounsaturatedFats: 0,
            polyunsaturatedFats: 0,
            alcohol: 0,
          },
          itemCount: 2,
          matchedCount: 2,
          diners: null,
          perPerson: null,
        },
        ...overrides,
      };
    case 'context_set':
      return {
        ...base,
        contextSet: overrides.contextSet ?? { chainSlug: 'mcdonalds-es', chainName: "McDonald's España" },
        ...overrides,
      };
    case 'reverse_search':
      return {
        ...base,
        reverseSearch: overrides.reverseSearch ?? {
          chainSlug: 'mcdonalds-es',
          chainName: "McDonald's España",
          maxCalories: 600,
          minProtein: null,
          results: [createReverseSearchResult()],
          totalMatches: 1,
        },
        ...overrides,
      };
    case 'text_too_long':
      return { ...base, ...overrides };
    default:
      return { ...base, ...overrides };
  }
}

// ---------------------------------------------------------------------------
// ConversationMessageResponse factory
// ---------------------------------------------------------------------------

export function createConversationMessageResponse(
  intent: ConversationMessageData['intent'] = 'estimation',
  overrides: Partial<ConversationMessageData> = {}
): ConversationMessageResponse {
  return {
    success: true,
    data: createConversationMessageData(intent, overrides),
  };
}

// ---------------------------------------------------------------------------
// MenuAnalysisDish factory
// ---------------------------------------------------------------------------

export function createMenuAnalysisDish(
  overrides: Partial<MenuAnalysisDish> = {}
): MenuAnalysisDish {
  return {
    dishName: 'Tortilla española',
    estimate: createEstimateData({ query: 'tortilla española' }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MenuAnalysisData factory
// ---------------------------------------------------------------------------

export function createMenuAnalysisData(
  overrides: Partial<MenuAnalysisData> = {}
): MenuAnalysisData {
  return {
    mode: 'identify',
    dishCount: 1,
    dishes: [createMenuAnalysisDish()],
    partial: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MenuAnalysisResponse factory
// ---------------------------------------------------------------------------

export function createMenuAnalysisResponse(
  overrides: Partial<MenuAnalysisData> = {}
): MenuAnalysisResponse {
  return {
    success: true,
    data: createMenuAnalysisData(overrides),
  };
}

// ---------------------------------------------------------------------------
// Voice conversation response factory (F091)
// ---------------------------------------------------------------------------

export function createVoiceConversationResponse(
  overrides: Partial<ConversationMessageData> = {}
): ConversationMessageResponse {
  // Voice responses use the same ConversationMessageResponse shape as text queries.
  // Default intent is 'estimation' — most common voice query result.
  return {
    success: true,
    data: createConversationMessageData('estimation', overrides),
  };
}

// ---------------------------------------------------------------------------
// ReverseSearchResult factory
// ---------------------------------------------------------------------------

export function createReverseSearchResult(
  overrides: Partial<ReverseSearchResult> = {}
): ReverseSearchResult {
  return {
    name: 'Ensalada César',
    nameEs: 'Ensalada César',
    calories: 350,
    proteins: 22,
    fats: 15,
    carbohydrates: 28,
    portionGrams: 300,
    proteinDensity: 0.073,
    ...overrides,
  };
}
