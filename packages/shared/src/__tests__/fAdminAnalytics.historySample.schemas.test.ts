// Unit tests for HistorySample admin schemas (F-ADMIN-ANALYTICS-UI B6)
//
// Tests: HistorySampleParamsSchema defaults/ranges/coercion,
//        SearchHistorySampleEntrySchema shape,
//        HistorySampleDataSchema,
//        HistorySampleResponseSchema golden parse.

import { describe, it, expect } from 'vitest';
import {
  HistorySampleParamsSchema,
  SearchHistorySampleEntrySchema,
  HistorySampleDataSchema,
  HistorySampleResponseSchema,
  AdminResultDataSchema,
} from '../schemas/analytics.js';

// ---------------------------------------------------------------------------
// HistorySampleParamsSchema
// ---------------------------------------------------------------------------

describe('HistorySampleParamsSchema', () => {
  it('applies defaults: hours=24, limit=20 when empty object', () => {
    const result = HistorySampleParamsSchema.parse({});
    expect(result.hours).toBe(24);
    expect(result.limit).toBe(20);
    expect(result.intent).toBeUndefined();
  });

  it('accepts hours=1 (minimum)', () => {
    const result = HistorySampleParamsSchema.safeParse({ hours: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts hours=720 (maximum)', () => {
    const result = HistorySampleParamsSchema.safeParse({ hours: 720 });
    expect(result.success).toBe(true);
  });

  it('rejects hours=0', () => {
    expect(HistorySampleParamsSchema.safeParse({ hours: 0 }).success).toBe(false);
  });

  it('rejects hours=721', () => {
    expect(HistorySampleParamsSchema.safeParse({ hours: 721 }).success).toBe(false);
  });

  it('accepts limit=1 (minimum)', () => {
    const result = HistorySampleParamsSchema.safeParse({ limit: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts limit=100 (maximum)', () => {
    const result = HistorySampleParamsSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects limit=0', () => {
    expect(HistorySampleParamsSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejects limit=101', () => {
    expect(HistorySampleParamsSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('coerces hours from string', () => {
    const result = HistorySampleParamsSchema.parse({ hours: '48' });
    expect(result.hours).toBe(48);
  });

  it('coerces limit from string', () => {
    const result = HistorySampleParamsSchema.parse({ limit: '50' });
    expect(result.limit).toBe(50);
  });

  it('accepts valid intent filter', () => {
    const result = HistorySampleParamsSchema.safeParse({ intent: 'estimation' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.intent).toBe('estimation');
  });

  it('rejects invalid intent value', () => {
    expect(HistorySampleParamsSchema.safeParse({ intent: 'not_real_intent' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AdminResultDataSchema
// ---------------------------------------------------------------------------

describe('AdminResultDataSchema', () => {
  it('does NOT include actorId field', () => {
    const shape = AdminResultDataSchema.shape;
    expect('actorId' in shape).toBe(false);
  });

  it('includes intent field', () => {
    const shape = AdminResultDataSchema.shape;
    expect('intent' in shape).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SearchHistorySampleEntrySchema
// ---------------------------------------------------------------------------

describe('SearchHistorySampleEntrySchema', () => {
  it('parses a valid entry', () => {
    const entry = {
      id: 'fd000000-0001-4000-a000-000000000001',
      kind: 'text',
      queryText: 'Big Mac',
      resultData: {
        intent: 'estimation',
        activeContext: null,
      },
      createdAt: '2026-06-11T10:00:00.000Z',
    };
    const result = SearchHistorySampleEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = SearchHistorySampleEntrySchema.safeParse({
      kind: 'text', queryText: 'test',
      resultData: { intent: 'estimation', activeContext: null },
      createdAt: '2026-06-11T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid kind', () => {
    const result = SearchHistorySampleEntrySchema.safeParse({
      id: 'fd000000-0001-4000-a000-000000000001',
      kind: 'photo',
      queryText: 'test',
      resultData: { intent: 'estimation', activeContext: null },
      createdAt: '2026-06-11T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HistorySampleDataSchema
// ---------------------------------------------------------------------------

describe('HistorySampleDataSchema', () => {
  it('parses valid data payload', () => {
    const data = {
      items: [],
      hours: 24,
      limit: 20,
    };
    const result = HistorySampleDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts intentFilter when present', () => {
    const data = {
      items: [],
      hours: 24,
      limit: 20,
      intentFilter: 'estimation',
    };
    const result = HistorySampleDataSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.intentFilter).toBe('estimation');
  });

  it('intentFilter is absent when not provided', () => {
    const data = { items: [], hours: 24, limit: 20 };
    const result = HistorySampleDataSchema.parse(data);
    expect(result.intentFilter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HistorySampleResponseSchema — golden parse
// ---------------------------------------------------------------------------

describe('HistorySampleResponseSchema', () => {
  it('parses a full golden response', () => {
    const response = {
      success: true,
      data: {
        items: [
          {
            id: 'fd000000-0001-4000-a000-000000000001',
            kind: 'voice',
            queryText: 'ensalada cesar',
            resultData: {
              intent: 'estimation',
              activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
            },
            createdAt: '2026-06-11T10:00:00.000Z',
          },
        ],
        hours: 24,
        limit: 20,
        intentFilter: 'estimation',
      },
    };
    const result = HistorySampleResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.items).toHaveLength(1);
      expect(result.data.data.items[0]?.['queryText']).toBe('ensalada cesar');
    }
  });

  it('rejects success=false', () => {
    expect(HistorySampleResponseSchema.safeParse({
      success: false, data: { items: [], hours: 24, limit: 20 },
    }).success).toBe(false);
  });
});
