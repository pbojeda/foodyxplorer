// F-UX-B — NutritionCard: Spanish portion-term assumptions display
// All 5 tests start RED (implementation not yet written).

import React from 'react';
import { render, screen } from '@testing-library/react';
import { NutritionCard } from '../../components/NutritionCard';
import { createEstimateData } from '../fixtures';
import type { PortionAssumption } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures — concrete PortionAssumption objects for each render path
// ---------------------------------------------------------------------------

// Path A — per_dish, pieces non-null (tapa de croquetas)
const paPerDishWithPieces: PortionAssumption = {
  term: 'tapa',
  termDisplay: 'tapa',
  source: 'per_dish',
  grams: 50,
  pieces: 2,
  pieceName: 'croquetas',
  gramsRange: null,
  confidence: 'high',
  fallbackReason: null,
};

// Path B — per_dish, pieces null (ración de gazpacho)
const paPerDishNoPieces: PortionAssumption = {
  term: 'racion',
  termDisplay: 'ración',
  source: 'per_dish',
  grams: 250,
  pieces: null,
  pieceName: null,
  gramsRange: null,
  confidence: 'medium',
  fallbackReason: null,
};

// Path C — generic (F085 fallback, no per-dish row)
const paGeneric: PortionAssumption = {
  term: 'tapa',
  termDisplay: 'tapa',
  source: 'generic',
  grams: 65,
  pieces: null,
  pieceName: null,
  gramsRange: [50, 80],
  confidence: null,
  fallbackReason: 'no_row',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NutritionCard — F-UX-B portion assumption display', () => {
  // T1 — per_dish + pieces non-null
  it('T1: renders ~N pieceName (≈ G g) for per_dish + pieces path', () => {
    const data = createEstimateData({ portionAssumption: paPerDishWithPieces });
    render(<NutritionCard estimateData={data} />);

    // The note element must exist
    const note = screen.getByRole('note');
    expect(note).toBeInTheDocument();

    // Text contains the piece + gram copy
    expect(note.textContent).toContain('~2 croquetas (≈ 50 g)');

    // aria-label must contain "aproximadamente" (accessibility requirement)
    expect(screen.getByLabelText(/aproximadamente/)).toBeInTheDocument();

    // Copy-discipline regex: ~N word (≈ N g) — uncertainty symbols always present
    expect(note.textContent).toMatch(/~\d+ [a-záéíóúñ]+ \(≈ \d+ g\)/);
  });

  // T2 — per_dish + pieces null
  it('T2: renders ≈ G g (no tilde) for per_dish + pieces null path', () => {
    const data = createEstimateData({ portionAssumption: paPerDishNoPieces });
    render(<NutritionCard estimateData={data} />);

    const note = screen.getByRole('note');
    expect(note).toBeInTheDocument();

    // Must contain ≈ grams
    expect(note.textContent).toContain('≈ 250 g');

    // Must NOT contain tilde (no piece count rendered)
    expect(note.textContent).not.toContain('~');

    // aria-label must contain "aproximadamente"
    expect(screen.getByLabelText(/aproximadamente/)).toBeInTheDocument();
  });

  // T3 — generic path
  it('T3: renders Term estándar: N–M g (estimado genérico) for generic path', () => {
    const data = createEstimateData({ portionAssumption: paGeneric });
    render(<NutritionCard estimateData={data} />);

    const note = screen.getByRole('note');
    expect(note).toBeInTheDocument();

    // Text contains the generic copy with range
    expect(note.textContent).toContain('Tapa estándar: 50–80 g');
    expect(note.textContent).toContain('estimado genérico');

    // "estimado genérico" must be in a <span class="italic"> element (not <em>)
    const italicSpan = note.querySelector('span.italic');
    expect(italicSpan).not.toBeNull();
    expect(italicSpan?.textContent).toBe('estimado genérico');

    // aria-label must contain "aproximadamente"
    expect(screen.getByLabelText(/aproximadamente/)).toBeInTheDocument();
  });

  // T4 — combined F-UX-A pill + F-UX-B line
  it('T4: F-UX-A pill and F-UX-B note are siblings inside a <section>', () => {
    const data = createEstimateData({
      portionMultiplier: 1.5,
      portionAssumption: paPerDishWithPieces,
      result: {
        entityType: 'dish',
        entityId: '123e4567-e89b-42d3-a456-426614174000',
        name: 'Big Mac',
        nameEs: 'Big Mac',
        restaurantId: null,
        chainSlug: 'mcdonalds-es',
        portionGrams: 300,
        nutrients: {
          calories: 825,
          proteins: 37.5,
          carbohydrates: 69,
          sugars: 13.5,
          fats: 42,
          saturatedFats: 15,
          fiber: 4.5,
          salt: 3.3,
          sodium: 1.32,
          transFats: 0,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          alcohol: 0,
          referenceBasis: 'per_serving',
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
    });
    render(<NutritionCard estimateData={data} />);

    // F-UX-A pill must be present
    const pill = screen.getByText('PORCIÓN GRANDE');
    expect(pill).toBeInTheDocument();

    // F-UX-B note must be present
    const note = screen.getByRole('note');
    expect(note).toBeInTheDocument();

    // Both must be inside the same <section>
    const pillSection = pill.closest('section');
    const noteSection = note.closest('section');
    expect(pillSection).not.toBeNull();
    expect(noteSection).not.toBeNull();
    expect(pillSection).toBe(noteSection);
  });

  // T5 — empty state: no portionAssumption
  it('T5: does NOT render role="note" when portionAssumption is absent', () => {
    // Default createEstimateData() has no portionAssumption field
    render(<NutritionCard estimateData={createEstimateData()} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
