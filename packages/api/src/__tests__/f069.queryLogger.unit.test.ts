// F069 — QueryLogger actor_id Integration Test
//
// Verifies that QueryLogEntry now includes actorId field.

import { describe, it, expect } from 'vitest';
import type { QueryLogEntry } from '../lib/queryLogger.js';

describe('F069 — QueryLogEntry includes actorId', () => {
  it('accepts actorId in QueryLogEntry', () => {
    const entry: QueryLogEntry = {
      queryText: 'tortilla de patatas',
      chainSlug: null,
      restaurantId: null,
      levelHit: 'l1',
      cacheHit: false,
      responseTimeMs: 42,
      apiKeyId: null,
      actorId: '00000000-0000-0000-0000-000000000099',
      source: 'api',
    };
    expect(entry.actorId).toBe('00000000-0000-0000-0000-000000000099');
  });

  it('accepts null actorId', () => {
    const entry: QueryLogEntry = {
      queryText: 'arroz blanco',
      chainSlug: null,
      restaurantId: null,
      levelHit: null,
      cacheHit: true,
      responseTimeMs: 5,
      apiKeyId: null,
      actorId: null,
      source: 'bot',
    };
    expect(entry.actorId).toBeNull();
  });
});
