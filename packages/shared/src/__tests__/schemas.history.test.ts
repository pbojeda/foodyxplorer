// F-WEB-HISTORY — Shared schema unit tests (AC5–AC7)
//
// Pure unit tests for SearchHistoryKindSchema, SearchHistoryEntrySchema,
// HistoryPageSchema. No network, no DB.

import { describe, it, expect } from 'vitest';
import {
  SearchHistoryKindSchema,
  SearchHistoryEntrySchema,
  HistoryPageSchema,
} from '../schemas/history.js';

// ---------------------------------------------------------------------------
// AC5: SearchHistoryKindSchema
// ---------------------------------------------------------------------------

describe('AC5: SearchHistoryKindSchema', () => {
  it('accepts text', () => {
    expect(SearchHistoryKindSchema.parse('text')).toBe('text');
  });

  it('accepts voice', () => {
    expect(SearchHistoryKindSchema.parse('voice')).toBe('voice');
  });

  it('rejects photo', () => {
    expect(() => SearchHistoryKindSchema.parse('photo')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => SearchHistoryKindSchema.parse('')).toThrow();
  });

  it('rejects unknown value', () => {
    expect(() => SearchHistoryKindSchema.parse('image')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC6: SearchHistoryEntrySchema
// ---------------------------------------------------------------------------

// Minimal valid ConversationMessageData (text_too_long has the simplest shape)
const VALID_RESULT_DATA = {
  intent: 'text_too_long' as const,
  actorId: '00000000-0000-0000-0000-000000000001',
  activeContext: null,
};

const VALID_ENTRY = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  kind: 'text' as const,
  queryText: 'big mac',
  resultData: VALID_RESULT_DATA,
  createdAt: new Date().toISOString(),
};

describe('AC6: SearchHistoryEntrySchema', () => {
  it('accepts a valid entry', () => {
    const result = SearchHistoryEntrySchema.parse(VALID_ENTRY);
    expect(result.id).toBe(VALID_ENTRY.id);
    expect(result.kind).toBe('text');
    expect(result.queryText).toBe('big mac');
  });

  it('rejects entry missing id', () => {
    const { id: _id, ...withoutId } = VALID_ENTRY;
    expect(() => SearchHistoryEntrySchema.parse(withoutId)).toThrow();
  });

  it('rejects entry with invalid UUID id', () => {
    expect(() =>
      SearchHistoryEntrySchema.parse({ ...VALID_ENTRY, id: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects entry with invalid kind', () => {
    expect(() =>
      SearchHistoryEntrySchema.parse({ ...VALID_ENTRY, kind: 'photo' }),
    ).toThrow();
  });

  it('rejects entry with empty queryText', () => {
    expect(() =>
      SearchHistoryEntrySchema.parse({ ...VALID_ENTRY, queryText: '' }),
    ).toThrow();
  });

  it('rejects entry with queryText exceeding 2000 chars', () => {
    expect(() =>
      SearchHistoryEntrySchema.parse({ ...VALID_ENTRY, queryText: 'a'.repeat(2001) }),
    ).toThrow();
  });

  it('accepts entry with queryText of exactly 2000 chars', () => {
    const result = SearchHistoryEntrySchema.parse({
      ...VALID_ENTRY,
      queryText: 'a'.repeat(2000),
    });
    expect(result.queryText).toHaveLength(2000);
  });

  it('rejects entry with invalid createdAt', () => {
    expect(() =>
      SearchHistoryEntrySchema.parse({ ...VALID_ENTRY, createdAt: 'not-a-date' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC7: HistoryPageSchema
// ---------------------------------------------------------------------------

describe('AC7: HistoryPageSchema', () => {
  it('accepts valid page with entries and null cursor', () => {
    const result = HistoryPageSchema.parse({
      entries: [],
      nextCursor: null,
    });
    expect(result.entries).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it('accepts valid page with entries and string cursor', () => {
    const result = HistoryPageSchema.parse({
      entries: [VALID_ENTRY],
      nextCursor: 'someopaquecursor',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.nextCursor).toBe('someopaquecursor');
  });

  it('rejects page where nextCursor is a number', () => {
    expect(() =>
      HistoryPageSchema.parse({ entries: [], nextCursor: 123 }),
    ).toThrow();
  });

  it('rejects page missing entries field', () => {
    expect(() =>
      HistoryPageSchema.parse({ nextCursor: null }),
    ).toThrow();
  });

  it('rejects page where entries is not an array', () => {
    expect(() =>
      HistoryPageSchema.parse({ entries: 'invalid', nextCursor: null }),
    ).toThrow();
  });
});
