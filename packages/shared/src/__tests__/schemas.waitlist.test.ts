// Unit tests for packages/shared/src/schemas/waitlist.ts
//
// Tests the three Zod schemas:
//   - CreateWaitlistSubmissionSchema — POST /waitlist body
//   - AdminWaitlistQuerySchema       — GET /admin/waitlist query params
//   - WaitlistSubmissionSchema       — full record shape

import { describe, it, expect } from 'vitest';
import {
  CreateWaitlistSubmissionSchema,
  AdminWaitlistQuerySchema,
  WaitlistSubmissionSchema,
} from '../schemas/waitlist.js';

// ---------------------------------------------------------------------------
// CreateWaitlistSubmissionSchema
// ---------------------------------------------------------------------------

describe('CreateWaitlistSubmissionSchema', () => {
  const validBody = {
    email: 'user@example.com',
    phone: '+34612345678',
    variant: 'a',
    source: 'hero',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'launch-2026',
    honeypot: '',
  };

  it('accepts a valid full body', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it('accepts body without optional fields', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      email: 'user@example.com',
      variant: 'a',
      source: 'hero',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      variant: 'a',
      source: 'hero',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      email: 'notanemail',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format (missing tld)', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      email: 'user@example',
    });
    expect(result.success).toBe(false);
  });

  it('allows empty string honeypot', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      honeypot: '',
    });
    expect(result.success).toBe(true);
  });

  it('allows non-empty honeypot (schema permits it — route rejects it)', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      honeypot: 'bot@spam.com',
    });
    expect(result.success).toBe(true);
  });

  it('allows undefined honeypot', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      honeypot: undefined,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid variant value', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      variant: 'z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid variant values: a, c, f', () => {
    for (const variant of ['a', 'c', 'f']) {
      const result = CreateWaitlistSubmissionSchema.safeParse({
        ...validBody,
        variant,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid source value', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      source: 'unknown-source',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid source values', () => {
    for (const source of ['hero', 'cta', 'footer', 'post-simulator']) {
      const result = CreateWaitlistSubmissionSchema.safeParse({
        ...validBody,
        source,
      });
      expect(result.success).toBe(true);
    }
  });

  it('trims whitespace from phone', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      phone: '  +34612345678  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('+34612345678');
    }
  });

  it('coerces empty phone string to null', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      ...validBody,
      phone: '   ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeNull();
    }
  });

  it('utm fields are optional — undefined when absent', () => {
    const result = CreateWaitlistSubmissionSchema.safeParse({
      email: 'user@example.com',
      variant: 'a',
      source: 'hero',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.utm_source).toBeUndefined();
      expect(result.data.utm_medium).toBeUndefined();
      expect(result.data.utm_campaign).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// AdminWaitlistQuerySchema
// ---------------------------------------------------------------------------

describe('AdminWaitlistQuerySchema', () => {
  it('applies defaults when no params provided', () => {
    const result = AdminWaitlistQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
      expect(result.data.sort).toBe('created_at_desc');
    }
  });

  it('coerces limit from string', () => {
    const result = AdminWaitlistQuerySchema.safeParse({ limit: '25' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it('coerces offset from string', () => {
    const result = AdminWaitlistQuerySchema.safeParse({ offset: '100' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offset).toBe(100);
    }
  });

  it('rejects limit above 200', () => {
    const result = AdminWaitlistQuerySchema.safeParse({ limit: '201' });
    expect(result.success).toBe(false);
  });

  it('accepts limit exactly at 200', () => {
    const result = AdminWaitlistQuerySchema.safeParse({ limit: '200' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(200);
    }
  });

  it('rejects negative offset', () => {
    const result = AdminWaitlistQuerySchema.safeParse({ offset: '-1' });
    expect(result.success).toBe(false);
  });

  it('accepts sort=created_at_asc', () => {
    const result = AdminWaitlistQuerySchema.safeParse({ sort: 'created_at_asc' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('created_at_asc');
    }
  });

  it('rejects invalid sort value', () => {
    const result = AdminWaitlistQuerySchema.safeParse({ sort: 'name_asc' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WaitlistSubmissionSchema
// ---------------------------------------------------------------------------

describe('WaitlistSubmissionSchema', () => {
  const validRecord = {
    id: 'fd000000-0046-4000-a000-000000000001',
    email: 'user@example.com',
    phone: '+34612345678',
    variant: 'a',
    source: 'hero',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'launch-2026',
    ipAddress: '1.2.3.4',
    createdAt: new Date('2026-03-28T12:00:00Z'),
  };

  it('validates a full record with all fields', () => {
    const result = WaitlistSubmissionSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  it('accepts null for nullable fields', () => {
    const result = WaitlistSubmissionSchema.safeParse({
      ...validRecord,
      phone: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      ipAddress: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const { id: _id, ...rest } = validRecord;
    const result = WaitlistSubmissionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
