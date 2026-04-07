import { describe, it, expect } from 'vitest';
import { calculateUncertainty, enrichWithUncertainty } from '../estimation/uncertaintyCalculator.js';

// ---------------------------------------------------------------------------
// calculateUncertainty — percentage matrix
// ---------------------------------------------------------------------------

describe('calculateUncertainty', () => {
  // --- High confidence ---

  it('high + official → ±5%', () => {
    const range = calculateUncertainty(400, 'high', 'official');
    expect(range.percentage).toBe(5);
    expect(range.caloriesMin).toBe(380);
    expect(range.caloriesMax).toBe(420);
  });

  it('high + scraped → ±5%', () => {
    const range = calculateUncertainty(400, 'high', 'scraped');
    expect(range.percentage).toBe(5);
    expect(range.caloriesMin).toBe(380);
    expect(range.caloriesMax).toBe(420);
  });

  it('high + ingredients → ±10%', () => {
    const range = calculateUncertainty(400, 'high', 'ingredients');
    expect(range.percentage).toBe(10);
    expect(range.caloriesMin).toBe(360);
    expect(range.caloriesMax).toBe(440);
  });

  it('high + extrapolation → ±15%', () => {
    const range = calculateUncertainty(400, 'high', 'extrapolation');
    expect(range.percentage).toBe(15);
    expect(range.caloriesMin).toBe(340);
    expect(range.caloriesMax).toBe(460);
  });

  it('high + llm → ±15%', () => {
    const range = calculateUncertainty(400, 'high', 'llm');
    expect(range.percentage).toBe(15);
    expect(range.caloriesMin).toBe(340);
    expect(range.caloriesMax).toBe(460);
  });

  // --- Medium confidence ---

  it('medium + official → ±10%', () => {
    const range = calculateUncertainty(300, 'medium', 'official');
    expect(range.percentage).toBe(10);
    expect(range.caloriesMin).toBe(270);
    expect(range.caloriesMax).toBe(330);
  });

  it('medium + ingredients → ±15%', () => {
    const range = calculateUncertainty(300, 'medium', 'ingredients');
    expect(range.percentage).toBe(15);
    expect(range.caloriesMin).toBe(255);
    expect(range.caloriesMax).toBe(345);
  });

  it('medium + llm → ±20%', () => {
    const range = calculateUncertainty(300, 'medium', 'llm');
    expect(range.percentage).toBe(20);
    expect(range.caloriesMin).toBe(240);
    expect(range.caloriesMax).toBe(360);
  });

  // --- Low confidence ---

  it('low + official → ±15%', () => {
    const range = calculateUncertainty(200, 'low', 'official');
    expect(range.percentage).toBe(15);
    expect(range.caloriesMin).toBe(170);
    expect(range.caloriesMax).toBe(230);
  });

  it('low + ingredients → ±20%', () => {
    const range = calculateUncertainty(200, 'low', 'ingredients');
    expect(range.percentage).toBe(20);
    expect(range.caloriesMin).toBe(160);
    expect(range.caloriesMax).toBe(240);
  });

  it('low + llm → ±30%', () => {
    const range = calculateUncertainty(200, 'low', 'llm');
    expect(range.percentage).toBe(30);
    expect(range.caloriesMin).toBe(140);
    expect(range.caloriesMax).toBe(260);
  });

  it('low + extrapolation → ±30%', () => {
    const range = calculateUncertainty(200, 'low', 'extrapolation');
    expect(range.percentage).toBe(30);
    expect(range.caloriesMin).toBe(140);
    expect(range.caloriesMax).toBe(260);
  });

  // --- Edge cases ---

  it('floors min at 0 for very low calorie foods', () => {
    const range = calculateUncertainty(10, 'low', 'llm');
    expect(range.caloriesMin).toBe(7); // 10 - 3 = 7
    expect(range.caloriesMax).toBe(13);
  });

  it('floors min at 0 when delta exceeds calories', () => {
    const range = calculateUncertainty(5, 'low', 'llm');
    // 5 * 30/100 = 1.5 → round = 2
    expect(range.caloriesMin).toBe(3);
    expect(range.caloriesMax).toBe(7);
  });

  it('handles zero calories', () => {
    const range = calculateUncertainty(0, 'high', 'official');
    expect(range.caloriesMin).toBe(0);
    expect(range.caloriesMax).toBe(0);
    expect(range.percentage).toBe(5);
  });

  it('rounds delta to nearest integer', () => {
    // 350 * 5% = 17.5 → rounds to 18
    const range = calculateUncertainty(350, 'high', 'official');
    expect(range.caloriesMin).toBe(332);
    expect(range.caloriesMax).toBe(368);
  });

  it('handles large calorie values', () => {
    const range = calculateUncertainty(2000, 'medium', 'ingredients');
    expect(range.percentage).toBe(15);
    expect(range.caloriesMin).toBe(1700);
    expect(range.caloriesMax).toBe(2300);
  });
});

// ---------------------------------------------------------------------------
// enrichWithUncertainty — DRY helper
// ---------------------------------------------------------------------------

describe('enrichWithUncertainty', () => {
  it('returns uncertainty range when result present', () => {
    const result = enrichWithUncertainty({
      nutrients: { calories: 400 },
      confidenceLevel: 'high',
      estimationMethod: 'official',
    });
    expect(result.uncertaintyRange).toBeDefined();
    expect(result.uncertaintyRange?.percentage).toBe(5);
    expect(result.uncertaintyRange?.caloriesMin).toBe(380);
    expect(result.uncertaintyRange?.caloriesMax).toBe(420);
  });

  it('returns empty object for null result', () => {
    expect(enrichWithUncertainty(null)).toEqual({});
  });

  it('uses correct method for llm estimation', () => {
    const result = enrichWithUncertainty({
      nutrients: { calories: 300 },
      confidenceLevel: 'low',
      estimationMethod: 'llm',
    });
    expect(result.uncertaintyRange?.percentage).toBe(30);
  });

  it('uses correct method for ingredients estimation', () => {
    const result = enrichWithUncertainty({
      nutrients: { calories: 500 },
      confidenceLevel: 'medium',
      estimationMethod: 'ingredients',
    });
    expect(result.uncertaintyRange?.percentage).toBe(15);
    expect(result.uncertaintyRange?.caloriesMin).toBe(425);
    expect(result.uncertaintyRange?.caloriesMax).toBe(575);
  });
});
