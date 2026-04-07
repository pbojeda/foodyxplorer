// Formatter tests for F089 — per-person display in menu estimation

import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  botConfig: {
    BOT_TOKEN: 'test-token',
    API_BASE_URL: 'http://localhost:3001',
    BOT_API_KEY: 'test-key',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { formatMenuEstimate } from '../formatters/menuFormatter.js';
import type { MenuEstimationData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOTALS = {
  calories: 1200, proteins: 60, carbohydrates: 120, sugars: 15,
  fats: 50, saturatedFats: 15, fiber: 8, salt: 3, sodium: 1200,
  transFats: 0, cholesterol: 80, potassium: 600,
  monounsaturatedFats: 15, polyunsaturatedFats: 8, alcohol: 10,
};

const PER_PERSON = {
  ...TOTALS,
  calories: 400, proteins: 20, carbohydrates: 40, fats: 16.67,
};

const BASE_DATA: MenuEstimationData = {
  items: [],
  totals: TOTALS,
  itemCount: 3,
  matchedCount: 3,
  diners: null,
  perPerson: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatMenuEstimate with diners (F089)', () => {
  it('without diners → no per-person section', () => {
    const result = formatMenuEstimate(BASE_DATA);
    expect(result).not.toContain('persona');
  });

  it('with diners=3 → shows per-person line', () => {
    const data: MenuEstimationData = {
      ...BASE_DATA,
      diners: 3,
      perPerson: PER_PERSON,
    };
    const result = formatMenuEstimate(data);
    expect(result).toContain('3 personas');
    expect(result).toContain('400');  // per-person calories
  });

  it('with diners=1 → shows "1 persona" (singular)', () => {
    const data: MenuEstimationData = {
      ...BASE_DATA,
      diners: 1,
      perPerson: TOTALS,
    };
    const result = formatMenuEstimate(data);
    expect(result).toContain('1 persona');
  });
});
