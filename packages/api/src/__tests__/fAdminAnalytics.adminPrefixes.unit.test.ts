// Unit tests for new adminPrefixes.ts helpers (F-ADMIN-ANALYTICS-UI B1)
//
// Verifies isAnalyticsRoute() and isKeyAdminRoute() split logic.
// Also verifies that ADMIN_PREFIXES (union) and isAdminRoute (legacy) remain intact.

import { describe, it, expect } from 'vitest';
import {
  ADMIN_PREFIXES,
  ANALYTICS_PREFIX,
  KEY_ADMIN_PREFIXES,
  isAdminRoute,
  isAnalyticsRoute,
  isKeyAdminRoute,
} from '../plugins/adminPrefixes.js';

describe('isAnalyticsRoute', () => {
  it('returns true for GET /analytics/queries', () => {
    expect(isAnalyticsRoute('/analytics/queries', 'GET')).toBe(true);
  });

  it('returns true for GET /analytics/missed-queries', () => {
    expect(isAnalyticsRoute('/analytics/missed-queries', 'GET')).toBe(true);
  });

  it('returns true for POST /analytics/missed-queries/track', () => {
    expect(isAnalyticsRoute('/analytics/missed-queries/track', 'POST')).toBe(true);
  });

  it('returns true for GET /analytics/history-sample', () => {
    expect(isAnalyticsRoute('/analytics/history-sample', 'GET')).toBe(true);
  });

  it('returns true for GET /analytics/web-events (GET not POST)', () => {
    expect(isAnalyticsRoute('/analytics/web-events', 'GET')).toBe(true);
  });

  it('returns false for POST /analytics/web-events (public sendBeacon exemption)', () => {
    expect(isAnalyticsRoute('/analytics/web-events', 'POST')).toBe(false);
  });

  it('returns false for /ingest/url', () => {
    expect(isAnalyticsRoute('/ingest/url', 'POST')).toBe(false);
  });

  it('returns false for /admin/waitlist', () => {
    expect(isAnalyticsRoute('/admin/waitlist', 'GET')).toBe(false);
  });

  it('returns false for undefined url', () => {
    expect(isAnalyticsRoute(undefined, 'GET')).toBe(false);
  });
});

describe('isKeyAdminRoute', () => {
  it('returns true for POST /ingest/url', () => {
    expect(isKeyAdminRoute('/ingest/url', 'POST')).toBe(true);
  });

  it('returns true for GET /quality/report', () => {
    expect(isKeyAdminRoute('/quality/report', 'GET')).toBe(true);
  });

  it('returns true for POST /embeddings/generate', () => {
    expect(isKeyAdminRoute('/embeddings/generate', 'POST')).toBe(true);
  });

  it('returns true for GET /admin/waitlist', () => {
    expect(isKeyAdminRoute('/admin/waitlist', 'GET')).toBe(true);
  });

  it('returns false for GET /analytics/queries', () => {
    expect(isKeyAdminRoute('/analytics/queries', 'GET')).toBe(false);
  });

  it('returns true for POST /restaurants (catalog admin write)', () => {
    expect(isKeyAdminRoute('/restaurants', 'POST')).toBe(true);
  });

  it('returns false for GET /restaurants (public catalog read)', () => {
    expect(isKeyAdminRoute('/restaurants', 'GET')).toBe(false);
  });

  it('returns false for /restaurants with no method', () => {
    expect(isKeyAdminRoute('/restaurants', undefined)).toBe(false);
  });

  it('returns false for undefined url', () => {
    expect(isKeyAdminRoute(undefined, 'GET')).toBe(false);
  });
});

describe('ADMIN_PREFIXES backward-compat (rateLimit.ts consumers)', () => {
  it('still includes /analytics/ in the union', () => {
    expect(ADMIN_PREFIXES).toContain('/analytics/');
  });

  it('still includes all original prefixes', () => {
    expect(ADMIN_PREFIXES).toContain('/ingest/');
    expect(ADMIN_PREFIXES).toContain('/quality/');
    expect(ADMIN_PREFIXES).toContain('/embeddings/');
    expect(ADMIN_PREFIXES).toContain('/admin/');
  });
});

describe('ANALYTICS_PREFIX and KEY_ADMIN_PREFIXES exports', () => {
  it('ANALYTICS_PREFIX is /analytics/', () => {
    expect(ANALYTICS_PREFIX).toBe('/analytics/');
  });

  it('KEY_ADMIN_PREFIXES does not include /analytics/', () => {
    expect(KEY_ADMIN_PREFIXES).not.toContain('/analytics/');
  });
});

describe('isAdminRoute backward-compat (unchanged behavior)', () => {
  it('still returns true for GET /analytics/queries', () => {
    expect(isAdminRoute('/analytics/queries', 'GET')).toBe(true);
  });

  it('still returns false for POST /analytics/web-events (public exemption)', () => {
    expect(isAdminRoute('/analytics/web-events', 'POST')).toBe(false);
  });
});
