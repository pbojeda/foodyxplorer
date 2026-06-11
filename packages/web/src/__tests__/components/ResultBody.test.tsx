// F-ADMIN-ANALYTICS-UI — ResultBody extracted component tests.
// Tests that ResultBody renders correctly for each intent type.
// Also verifies TranscriptEntry still works (regression guard).

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { ConversationMessageData } from '@foodxplorer/shared';
import { ResultBody } from '../../components/ResultBody';

// ---------------------------------------------------------------------------
// Mock child components to isolate ResultBody rendering
// ---------------------------------------------------------------------------

jest.mock('../../components/NutritionCard', () => ({
  NutritionCard: ({ estimateData, reverseResult }: { estimateData?: unknown; reverseResult?: unknown }) => (
    <div data-testid="nutrition-card" data-estimate={JSON.stringify(estimateData)} data-reverse={JSON.stringify(reverseResult)} />
  ),
}));

jest.mock('../../components/ContextConfirmation', () => ({
  ContextConfirmation: ({ contextSet }: { contextSet?: unknown }) => (
    <div data-testid="context-confirmation" data-context={JSON.stringify(contextSet)} />
  ),
}));

jest.mock('../../components/MenuDishList', () => ({
  MenuDishList: ({ dishes }: { dishes?: unknown[] }) => (
    <div data-testid="menu-dish-list" data-count={dishes?.length ?? 0} />
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const estimationData: ConversationMessageData = {
  intent: 'estimation',
  actorId: 'actor-uuid-1234',
  estimation: {
    dishName: 'Tortilla española',
    calories: 350,
    protein: 12,
    carbs: 20,
    fat: 18,
    fiber: 1,
    confidence: 'HIGH',
    allergens: [],
    portionDescription: '1 ración',
    portionGrams: 150,
  },
};

const comparisonData: ConversationMessageData = {
  intent: 'comparison',
  actorId: 'actor-uuid-1234',
  comparison: {
    dishA: {
      dishName: 'Plato A',
      calories: 200,
      protein: 10,
      carbs: 20,
      fat: 8,
      fiber: 2,
      confidence: 'HIGH',
      allergens: [],
      portionDescription: '1 ración',
      portionGrams: 100,
    },
    dishB: {
      dishName: 'Plato B',
      calories: 300,
      protein: 15,
      carbs: 30,
      fat: 12,
      fiber: 3,
      confidence: 'MEDIUM',
      allergens: [],
      portionDescription: '1 ración',
      portionGrams: 150,
    },
  },
};

const menuEstimationData: ConversationMessageData = {
  intent: 'menu_estimation',
  actorId: 'actor-uuid-1234',
  menuEstimation: {
    items: [
      {
        query: 'paella',
        estimation: {
          dishName: 'Paella',
          calories: 450,
          protein: 20,
          carbs: 60,
          fat: 12,
          fiber: 3,
          confidence: 'HIGH',
          allergens: [],
          portionDescription: '1 ración',
          portionGrams: 250,
        },
      },
    ],
  },
};

const contextSetData: ConversationMessageData = {
  intent: 'context_set',
  actorId: 'actor-uuid-1234',
  contextSet: { field: 'portion', value: '200g' },
};

const reverseSearchData: ConversationMessageData = {
  intent: 'reverse_search',
  actorId: 'actor-uuid-1234',
  reverseSearch: {
    results: [
      {
        name: 'Ensalada',
        calories: 120,
        protein: 5,
        carbs: 10,
        fat: 5,
        fiber: 3,
        confidence: 'HIGH',
        allergens: [],
      },
    ],
  },
};

const followUpAttributeData: ConversationMessageData = {
  intent: 'follow_up_attribute',
  actorId: 'actor-uuid-1234',
  followUpAttribute: {
    dishName: 'Tortilla',
    nutrientLabel: 'Proteína',
    value: '12',
    unit: 'g',
    priorEstimation: {
      dishName: 'Tortilla española',
      calories: 350,
      protein: 12,
      carbs: 20,
      fat: 18,
      fiber: 1,
      confidence: 'HIGH',
      allergens: [],
      portionDescription: '1 ración',
      portionGrams: 150,
    },
  },
};

const followUpRefinementData: ConversationMessageData = {
  intent: 'follow_up_refinement',
  actorId: 'actor-uuid-1234',
  followUpRefinement: {
    mergedQuery: 'tortilla con 200g',
    estimation: {
      dishName: 'Tortilla española',
      calories: 466,
      protein: 16,
      carbs: 26,
      fat: 24,
      fiber: 1,
      confidence: 'HIGH',
      allergens: [],
      portionDescription: '200g',
      portionGrams: 200,
    },
  },
};

const textTooLongData: ConversationMessageData = {
  intent: 'text_too_long',
  actorId: 'actor-uuid-1234',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResultBody', () => {
  it('renders NutritionCard for estimation intent', () => {
    render(<ResultBody data={estimationData} />);
    expect(screen.getByTestId('nutrition-card')).toBeInTheDocument();
  });

  it('renders two NutritionCards for comparison intent', () => {
    render(<ResultBody data={comparisonData} />);
    const cards = screen.getAllByTestId('nutrition-card');
    expect(cards).toHaveLength(2);
  });

  it('renders NutritionCard items for menu_estimation intent', () => {
    render(<ResultBody data={menuEstimationData} />);
    expect(screen.getByTestId('nutrition-card')).toBeInTheDocument();
  });

  it('renders ContextConfirmation for context_set intent', () => {
    render(<ResultBody data={contextSetData} />);
    expect(screen.getByTestId('context-confirmation')).toBeInTheDocument();
  });

  it('renders NutritionCard(s) for reverse_search intent with results', () => {
    render(<ResultBody data={reverseSearchData} />);
    expect(screen.getByTestId('nutrition-card')).toBeInTheDocument();
  });

  it('renders nutrient answer for follow_up_attribute intent', () => {
    render(<ResultBody data={followUpAttributeData} />);
    expect(screen.getByTestId('nutrient-answer-banner')).toBeInTheDocument();
  });

  it('renders NutritionCard for follow_up_refinement intent', () => {
    render(<ResultBody data={followUpRefinementData} />);
    expect(screen.getByTestId('nutrition-card')).toBeInTheDocument();
  });

  it('returns null for text_too_long intent', () => {
    const { container } = render(<ResultBody data={textTooLongData} />);
    expect(container.firstChild).toBeNull();
  });

  it('accepts AdminResultData (no actorId) without crashing', () => {
    // AdminResultData omits actorId — simulate by passing data without actorId
    const adminData: Omit<ConversationMessageData, 'actorId'> = {
      intent: 'estimation',
      estimation: estimationData.estimation,
    };
    // Cast — ResultBody accepts ConversationMessageData; AdminResultData is a subset
    render(<ResultBody data={adminData as ConversationMessageData} />);
    expect(screen.getByTestId('nutrition-card')).toBeInTheDocument();
  });
});
