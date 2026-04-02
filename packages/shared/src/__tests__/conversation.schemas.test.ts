// Unit tests for conversation.ts Zod schemas (F070)
//
// Covers: ConversationMessageBodySchema, ConversationIntentSchema,
//         ConversationMessageDataSchema — valid inputs, invalid inputs,
//         trim behaviour, min/max bounds, optional field presence by intent.

import { describe, it, expect } from 'vitest';
import {
  ConversationMessageBodySchema,
  ConversationIntentSchema,
  ConversationMessageDataSchema,
} from '../schemas/conversation.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ESTIMATE_DATA = {
  query: 'big mac',
  chainSlug: 'mcdonalds-es',
  portionMultiplier: 1,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  result: null,
  cachedAt: null,
};

// ---------------------------------------------------------------------------
// ConversationMessageBodySchema
// ---------------------------------------------------------------------------

describe('ConversationMessageBodySchema', () => {
  it('parses a minimal valid body with just text', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'big mac' });
    expect(result.success).toBe(true);
  });

  it('parses body with optional chainSlug and chainName', () => {
    const result = ConversationMessageBodySchema.safeParse({
      text: 'big mac',
      chainSlug: 'mcdonalds-es',
      chainName: "McDonald's",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chainSlug).toBe('mcdonalds-es');
      expect(result.data.chainName).toBe("McDonald's");
    }
  });

  it('trims leading and trailing whitespace from text', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: '  big mac  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('big mac');
    }
  });

  it('rejects empty string after trim', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects text that exceeds 2000 chars', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'a'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('accepts text at exactly 2000 chars', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'a'.repeat(2000) });
    expect(result.success).toBe(true);
  });

  it('accepts text at exactly 1 char', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'x' });
    expect(result.success).toBe(true);
  });

  it('rejects missing text field', () => {
    const result = ConversationMessageBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('chainSlug and chainName are optional — absent is valid', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'pollo' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chainSlug).toBeUndefined();
      expect(result.data.chainName).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ConversationIntentSchema
// ---------------------------------------------------------------------------

describe('ConversationIntentSchema', () => {
  it('accepts context_set', () => {
    expect(ConversationIntentSchema.safeParse('context_set').success).toBe(true);
  });

  it('accepts comparison', () => {
    expect(ConversationIntentSchema.safeParse('comparison').success).toBe(true);
  });

  it('accepts estimation', () => {
    expect(ConversationIntentSchema.safeParse('estimation').success).toBe(true);
  });

  it('accepts text_too_long', () => {
    expect(ConversationIntentSchema.safeParse('text_too_long').success).toBe(true);
  });

  it('rejects unknown intent', () => {
    expect(ConversationIntentSchema.safeParse('unknown').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(ConversationIntentSchema.safeParse('').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConversationMessageDataSchema
// ---------------------------------------------------------------------------

describe('ConversationMessageDataSchema', () => {
  describe('intent: text_too_long', () => {
    it('parses minimal text_too_long response with null activeContext', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'text_too_long',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });

    it('parses text_too_long with an activeContext', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'text_too_long',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: context_set (resolved)', () => {
    it('parses context_set resolved response', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'context_set',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
        activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: context_set (ambiguous)', () => {
    it('parses context_set ambiguous response', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'context_set',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        ambiguous: true,
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: estimation', () => {
    it('parses estimation response', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'estimation',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        estimation: VALID_ESTIMATE_DATA,
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: comparison', () => {
    it('parses comparison response with both dishes', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'comparison',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        comparison: {
          dishA: VALID_ESTIMATE_DATA,
          dishB: VALID_ESTIMATE_DATA,
        },
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });

    it('parses comparison response with optional nutrientFocus', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'comparison',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        comparison: {
          dishA: VALID_ESTIMATE_DATA,
          dishB: VALID_ESTIMATE_DATA,
          nutrientFocus: 'calorías',
        },
        activeContext: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.comparison?.nutrientFocus).toBe('calorías');
      }
    });
  });

  describe('validation failures', () => {
    it('rejects missing intent', () => {
      const result = ConversationMessageDataSchema.safeParse({
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid intent value', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'invalid_intent',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-uuid actorId', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'estimation',
        actorId: 'not-a-uuid',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing actorId', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'estimation',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-null/non-object activeContext', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'text_too_long',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: 'not-an-object',
      });
      expect(result.success).toBe(false);
    });
  });
});
