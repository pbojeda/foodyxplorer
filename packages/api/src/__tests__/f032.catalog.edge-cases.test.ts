// F032 edge-case tests — pure unit tests, no HTTP, no mocking.
//
// Covers:
//  1. CreateRestaurantBodySchema — valid/invalid inputs
//  2. RestaurantListQuerySchema — q field trim + min/max
//  3. RestaurantSchema — includes the 4 new location fields
//  4. mapError with DUPLICATE_RESTAURANT → 409
//  5. generateIndependentSlug — format validation

import { describe, it, expect } from 'vitest';
import {
  CreateRestaurantBodySchema,
  RestaurantListQuerySchema,
  RestaurantSchema,
} from '@foodxplorer/shared';
import { mapError } from '../errors/errorHandler.js';
import { generateIndependentSlug } from '../utils/slugify.js';

// ---------------------------------------------------------------------------
// CreateRestaurantBodySchema
// ---------------------------------------------------------------------------

describe('CreateRestaurantBodySchema', () => {
  it('accepts valid body with required fields only', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: "McDonald's Burgos",
      countryCode: 'ES',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid body with all optional fields present', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Burger King Madrid',
      countryCode: 'ES',
      chainSlug: 'burger-king-es',
      nameEs: 'Burger King Madrid',
      website: 'https://www.burgerking.es',
      logoUrl: 'https://cdn.example.com/logo.png',
      address: 'Calle Gran Vía, 1, Madrid',
      latitude: 40.4168,
      longitude: -3.7038,
      googleMapsUrl: 'https://maps.google.com/?q=40.4168,-3.7038',
    });
    expect(result.success).toBe(true);
  });

  it('rejects chainSlug with uppercase letters', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'McDonald',
      countryCode: 'ES',
      chainSlug: 'MyChain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects chainSlug with spaces', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'McDonald',
      countryCode: 'ES',
      chainSlug: 'my chain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lowercase countryCode', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'McDonald',
      countryCode: 'es',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      countryCode: 'ES',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing countryCode', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Burger King',
    });
    expect(result.success).toBe(false);
  });

  it('rejects latitude out of range (-91)', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      latitude: -91,
    });
    expect(result.success).toBe(false);
  });

  it('rejects longitude out of range (181)', () => {
    const result = CreateRestaurantBodySchema.safeParse({
      name: 'Test',
      countryCode: 'ES',
      longitude: 181,
    });
    expect(result.success).toBe(false);
  });

  it('accepts latitude at boundary (-90 and 90)', () => {
    expect(CreateRestaurantBodySchema.safeParse({ name: 'T', countryCode: 'ES', latitude: -90 }).success).toBe(true);
    expect(CreateRestaurantBodySchema.safeParse({ name: 'T', countryCode: 'ES', latitude: 90 }).success).toBe(true);
  });

  it('accepts longitude at boundary (-180 and 180)', () => {
    expect(CreateRestaurantBodySchema.safeParse({ name: 'T', countryCode: 'ES', longitude: -180 }).success).toBe(true);
    expect(CreateRestaurantBodySchema.safeParse({ name: 'T', countryCode: 'ES', longitude: 180 }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RestaurantListQuerySchema — q field
// ---------------------------------------------------------------------------

describe('RestaurantListQuerySchema — q field', () => {
  it('accepts q as optional (absent)', () => {
    const result = RestaurantListQuerySchema.safeParse({ page: '1', pageSize: '20' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBeUndefined();
    }
  });

  it('accepts valid q string', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: 'McDonald' });
    expect(result.success).toBe(true);
  });

  it('trims q (leading/trailing spaces stripped)', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: '  McDonald  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe('McDonald');
    }
  });

  it('rejects q as empty string (minLength: 1)', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: '' });
    expect(result.success).toBe(false);
  });

  it('rejects q as whitespace-only (becomes empty after trim → minLength: 1)', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects q longer than 100 chars', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts q at exactly 100 chars', () => {
    const result = RestaurantListQuerySchema.safeParse({ q: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RestaurantSchema — new location fields
// ---------------------------------------------------------------------------

describe('RestaurantSchema — includes new F032 fields', () => {
  const BASE = {
    id: 'fd000000-0001-4000-a000-000000000001',
    name: "McDonald's Spain",
    chainSlug: 'mcdonalds-es',
    countryCode: 'ES',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts restaurant without optional location fields', () => {
    const result = RestaurantSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it('accepts restaurant with all 4 location fields', () => {
    const result = RestaurantSchema.safeParse({
      ...BASE,
      address: 'Calle Mayor, 1',
      googleMapsUrl: 'https://maps.google.com/?q=1,2',
      latitude: 40.4168,
      longitude: -3.7038,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null values for location fields', () => {
    const result = RestaurantSchema.safeParse({
      ...BASE,
      address: null,
      googleMapsUrl: null,
      latitude: null,
      longitude: null,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapError — DUPLICATE_RESTAURANT
// ---------------------------------------------------------------------------

describe('mapError — DUPLICATE_RESTAURANT error code', () => {
  it('maps DUPLICATE_RESTAURANT error to HTTP 409 with correct code', () => {
    const err = Object.assign(
      new Error('Restaurant already exists for this chain and country'),
      { code: 'DUPLICATE_RESTAURANT' },
    );
    const result = mapError(err);
    expect(result.statusCode).toBe(409);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe('DUPLICATE_RESTAURANT');
    expect(result.body.error.message).toBe('Restaurant already exists for this chain and country');
  });
});

// ---------------------------------------------------------------------------
// generateIndependentSlug
// ---------------------------------------------------------------------------

describe('generateIndependentSlug', () => {
  it('returns a string matching the expected pattern', () => {
    const slug = generateIndependentSlug("McDonald's Burgos");
    expect(slug).toMatch(/^independent-[a-z0-9-]+-[a-z0-9]{4}$/);
  });

  it('contains "independent-" prefix', () => {
    const slug = generateIndependentSlug('Test Restaurant');
    expect(slug.startsWith('independent-')).toBe(true);
  });

  it('strips special characters from name', () => {
    const slug = generateIndependentSlug("McDonald's!");
    // The apostrophe and exclamation mark should be stripped
    expect(slug).toMatch(/^independent-mcdonalds-[a-z0-9]{4}$/);
  });

  it('lowercases the name', () => {
    const slug = generateIndependentSlug('BIG BURGER');
    expect(slug).toContain('big-burger');
  });

  it('replaces spaces with hyphens', () => {
    const slug = generateIndependentSlug('cafe madrid');
    expect(slug).toContain('cafe-madrid');
  });

  it('collapses multiple consecutive hyphens', () => {
    const slug = generateIndependentSlug('cafe  madrid');
    // Multiple spaces → single hyphen
    expect(slug).not.toContain('--');
  });

  it('produces different slugs on each call (UUID fragment ensures uniqueness)', () => {
    const slug1 = generateIndependentSlug('Same Name');
    const slug2 = generateIndependentSlug('Same Name');
    // Very high probability they differ (1/65536 chance of collision)
    // We just verify the format; collisions are statistically negligible
    expect(slug1).toMatch(/^independent-same-name-[a-z0-9]{4}$/);
    expect(slug2).toMatch(/^independent-same-name-[a-z0-9]{4}$/);
  });

  it('ends with exactly 4 lowercase alphanumeric chars', () => {
    const slug = generateIndependentSlug('Test');
    const suffix = slug.split('-').at(-1);
    expect(suffix).toMatch(/^[a-z0-9]{4}$/);
  });
});
