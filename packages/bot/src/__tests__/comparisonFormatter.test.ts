// Unit tests for comparisonFormatter.
// No mocks — tests against actual output strings.

import { describe, it, expect } from 'vitest';
import type { EstimateData } from '@foodxplorer/shared';
import { formatComparison } from '../formatters/comparisonFormatter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NUTRIENTS_A = {
  calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
  fats: 30, saturatedFats: 10, fiber: 3, salt: 2.5, sodium: 940,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const NUTRIENTS_B = {
  calories: 672, proteins: 25, carbohydrates: 56, sugars: 0,
  fats: 35, saturatedFats: 14, fiber: 2, salt: 3, sodium: 860,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const DEFAULT_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0001-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac' as string | null,
  restaurantId: 'fd000000-0002-4000-a000-000000000001' as string | null,
  chainSlug: null as string | null,
  portionGrams: 200 as number | null,
  nutrients: NUTRIENTS_A,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official' as const, url: null as string | null },
  similarityDistance: null as number | null,
};

function makeEstimateData(overrides: Record<string, unknown> = {}): EstimateData {
  const { result: resultOverride, ...restOverrides } = overrides;
  const base: EstimateData = {
    query: 'test',
    chainSlug: null,
    portionMultiplier: 1.0,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish',
    cachedAt: null,
    result: resultOverride === null
      ? null
      : { ...DEFAULT_RESULT, ...(resultOverride as Record<string, unknown> ?? {}) },
    ...restOverrides,
  };
  // Re-apply result after restOverrides to avoid it being overwritten
  if (resultOverride === null) base.result = null;
  return base;
}

const DATA_A: EstimateData = makeEstimateData({
  query: 'big mac',
  result: { name: 'Big Mac', nameEs: 'Big Mac', nutrients: NUTRIENTS_A, confidenceLevel: 'high', chainSlug: 'mcdonalds-es' },
});

const DATA_B: EstimateData = makeEstimateData({
  query: 'whopper',
  result: { name: 'Whopper', nameEs: 'Whopper', nutrients: NUTRIENTS_B, confidenceLevel: 'medium', chainSlug: 'burger-king-es' },
});

const DATA_NULL: EstimateData = makeEstimateData({
  query: 'xyz',
  result: null,
  level1Hit: false,
  matchType: null,
});

// ---------------------------------------------------------------------------
// Both results non-null (happy path)
// ---------------------------------------------------------------------------
describe('formatComparison — both results', () => {
  it('contains bold header with dish names', () => {
    const out = formatComparison(DATA_A, DATA_B);
    expect(out).toContain('*Big Mac*');
    expect(out).toContain('*Whopper*');
  });

  it('contains a code block (triple backticks)', () => {
    const out = formatComparison(DATA_A, DATA_B);
    expect(out).toContain('```');
    // Exactly two occurrences of ``` (open + close)
    const backtickCount = (out.match(/```/g) ?? []).length;
    expect(backtickCount).toBe(2);
  });

  it('shows calorie values inside code block without backslash escaping', () => {
    const out = formatComparison(DATA_A, DATA_B);
    // Extract code block content
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    expect(codeBlock).toContain('563');
    expect(codeBlock).toContain('672');
    // No escaped dots inside code block
    expect(codeBlock).not.toContain('\\.');
  });

  it('places ✅ on the LOWER calories side (A=563 wins over B=672)', () => {
    const out = formatComparison(DATA_A, DATA_B);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const calLine = codeBlock.split('\n').find(l => l.includes('Calorías'));
    expect(calLine).toBeTruthy();
    // ✅ should appear before the second value (A column wins)
    const checkIdx = calLine?.indexOf('✅') ?? -1;
    const val672Idx = calLine?.indexOf('672') ?? -1;
    expect(checkIdx).toBeLessThan(val672Idx);
  });

  it('places ✅ on the HIGHER proteins side (A=26.5 wins over B=25)', () => {
    const out = formatComparison(DATA_A, DATA_B);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const protLine = codeBlock.split('\n').find(l => l.includes('Proteínas'));
    expect(protLine).toBeTruthy();
    const checkIdx = protLine?.indexOf('✅') ?? -1;
    const val25Idx = protLine?.lastIndexOf('25') ?? -1;
    expect(checkIdx).toBeLessThan(val25Idx);
  });

  it('shows no ✅ when calorie values are equal', () => {
    const equalData = makeEstimateData({
      query: 'test',
      result: { name: 'TestB', nameEs: 'TestB', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const out = formatComparison(DATA_A, equalData);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const calLine = codeBlock.split('\n').find(l => l.includes('Calorías'));
    expect(calLine).not.toContain('✅');
  });

  it('shows optional rows (fiber, saturatedFats, sodium, salt) when > 0 in either dish', () => {
    const out = formatComparison(DATA_A, DATA_B);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    expect(codeBlock).toContain('Fibra');
    expect(codeBlock).toContain('Grasas sat');
    expect(codeBlock).toContain('Sodio');
    expect(codeBlock).toContain('Sal');
  });

  it('hides optional rows when both sides are 0', () => {
    const zeroNutrients = { ...NUTRIENTS_A, fiber: 0, saturatedFats: 0, sodium: 0, salt: 0 };
    const zeroA = makeEstimateData({ result: { name: 'A', nameEs: 'A', nutrients: zeroNutrients, confidenceLevel: 'high' } });
    const zeroB = makeEstimateData({ result: { name: 'B', nameEs: 'B', nutrients: zeroNutrients, confidenceLevel: 'high' } });
    const out = formatComparison(zeroA, zeroB);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    expect(codeBlock).not.toContain('Fibra');
    expect(codeBlock).not.toContain('Grasas sat');
    expect(codeBlock).not.toContain('Sodio');
  });

  it('shows confidence line as italic outside code block', () => {
    const out = formatComparison(DATA_A, DATA_B);
    expect(out).toContain('_Confianza: alta / media_');
  });

  it('shows chain line when both have chainSlug', () => {
    const out = formatComparison(DATA_A, DATA_B);
    expect(out).toMatch(/Cadena:.*mcdonalds/);
    expect(out).toMatch(/Cadena:.*burger/);
  });

  it('shows chain line for one side only when only one has chainSlug', () => {
    const noChainB = makeEstimateData({
      query: 'whopper',
      result: { name: 'Whopper', nameEs: 'Whopper', nutrients: NUTRIENTS_B, confidenceLevel: 'medium', chainSlug: null },
    });
    const out = formatComparison(DATA_A, noChainB);
    expect(out).toMatch(/Cadena:.*mcdonalds/);
  });
});

// ---------------------------------------------------------------------------
// nutrientFocus
// ---------------------------------------------------------------------------
describe('formatComparison — nutrientFocus', () => {
  it('renders focus nutrient row first with (foco) label', () => {
    const out = formatComparison(DATA_A, DATA_B, 'grasas');
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const lines = codeBlock.split('\n').filter(l => l.trim());
    // First data row (after header) should contain Grasas and (foco)
    const firstDataRow = lines.find(l => l.includes('(foco)'));
    expect(firstDataRow).toContain('Grasas');
  });

  it('shows tie indicator "—" for focus nutrient when values are equal', () => {
    const equalB = makeEstimateData({
      query: 'b',
      result: { name: 'B', nameEs: 'B', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const out = formatComparison(DATA_A, equalB, 'calorías');
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const focusLine = codeBlock.split('\n').find(l => l.includes('(foco)'));
    expect(focusLine).toContain('—');
  });
});

// ---------------------------------------------------------------------------
// Partial data (one null)
// ---------------------------------------------------------------------------
describe('formatComparison — one result null', () => {
  it('shows single dish card when B is null', () => {
    const out = formatComparison(DATA_A, DATA_NULL);
    // Should contain the available dish data
    expect(out).toContain('Big Mac');
    expect(out).toContain('563');
  });

  it('appends "no data" note for the null side', () => {
    const out = formatComparison(DATA_A, DATA_NULL);
    expect(out).toContain('No se encontraron datos');
  });

  it('shows single dish card when A is null', () => {
    const out = formatComparison(DATA_NULL, DATA_B);
    expect(out).toContain('Whopper');
    expect(out).toContain('672');
  });
});

// ---------------------------------------------------------------------------
// Both null
// ---------------------------------------------------------------------------
describe('formatComparison — both null', () => {
  it('returns standard no-data message', () => {
    const out = formatComparison(DATA_NULL, DATA_NULL);
    expect(out).toContain('No se encontraron datos nutricionales para ninguno de los platos');
  });
});

// ---------------------------------------------------------------------------
// MarkdownV2 correctness
// ---------------------------------------------------------------------------
describe('formatComparison — MarkdownV2 correctness', () => {
  it('escapes dots in header names outside code block', () => {
    const dotName = makeEstimateData({
      result: { name: 'Big Mac Jr.', nameEs: 'Big Mac Jr.', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const out = formatComparison(dotName, DATA_B);
    // Outside the code block, dots must be escaped
    const headerLine = out.split('\n')[0];
    expect(headerLine).toContain('Big Mac Jr\\.');
  });

  it('does NOT escape dots inside the code block', () => {
    const out = formatComparison(DATA_A, DATA_B);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    // 26.5 should appear raw, not as 26\.5
    expect(codeBlock).toContain('26.5');
    expect(codeBlock).not.toContain('26\\.5');
  });
});

// ---------------------------------------------------------------------------
// Portion modifier
// ---------------------------------------------------------------------------
describe('formatComparison — portion multiplier', () => {
  it('shows portion line when multiplier !== 1.0', () => {
    const bigA = makeEstimateData({
      query: 'big mac grande',
      portionMultiplier: 1.5,
      result: { name: 'Big Mac', nameEs: 'Big Mac', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const out = formatComparison(bigA, DATA_B);
    expect(out).toMatch(/[Pp]orci[oó]n.*1\.5|grande/);
  });
});

// ---------------------------------------------------------------------------
// Name truncation
// ---------------------------------------------------------------------------
describe('formatComparison — name truncation in code block', () => {
  it('truncates names > 12 chars in code block columns', () => {
    const longNameA = makeEstimateData({
      result: { name: 'Hamburguesa de Pollo Grande', nameEs: 'Hamburguesa de Pollo Grande', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const longNameB = makeEstimateData({
      result: { name: 'Ensalada César Premium', nameEs: 'Ensalada César Premium', nutrients: NUTRIENTS_B, confidenceLevel: 'medium' },
    });
    const out = formatComparison(longNameA, longNameB);
    // Full names appear in bold header
    expect(out).toContain('Hamburguesa de Pollo Grande');
    // Truncated names (<=12 chars) appear in code block header
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const headerLine = codeBlock.split('\n').find(l => !l.includes('Calorías') && !l.includes('Proteínas') && l.trim().length > 0);
    // Each column name should be at most 12 chars
    if (headerLine) {
      // The truncated names should be present, not the full names
      expect(codeBlock).not.toContain('Hamburguesa de Pollo Grande');
    }
  });
});

// ---------------------------------------------------------------------------
// Error notes
// ---------------------------------------------------------------------------
describe('formatComparison — error notes', () => {
  it('shows timeout note when errorNoteA is "timeout"', () => {
    const out = formatComparison(DATA_NULL, DATA_B, undefined, { errorNoteA: 'timeout' });
    expect(out).toContain('Tiempo de espera agotado');
  });

  it('shows generic error note when errorNoteB is "error"', () => {
    const out = formatComparison(DATA_A, DATA_NULL, undefined, { errorNoteB: 'error' });
    expect(out).toContain('No se encontraron datos');
  });
});
