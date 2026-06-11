// adminPrefixes.ts — Shared admin route prefix constants (F026, F-ADMIN-ANALYTICS-UI)
//
// Extracted to avoid circular dependency between auth.ts and rateLimit.ts.
// Both modules import from here instead of from each other.
//
// F-ADMIN-ANALYTICS-UI (ADR-031): Split admin auth into two paths:
//   - Analytics routes (/analytics/*) → bearer-only via requireAdminBearer preHandler
//   - Key-admin routes (all other admin prefixes) → X-API-Key via validateAdminKey
//
// ADMIN_PREFIXES (union) preserved for rateLimit.ts allowList — DO NOT REMOVE /analytics/.

/** Admin route URL prefixes (trailing slash required for prefix matching) */
export const ADMIN_PREFIXES = ['/ingest/', '/quality/', '/embeddings/', '/analytics/', '/admin/'] as const;

/**
 * Analytics prefix — bearer-only auth path (ADR-031).
 * rateLimit.ts allowList includes all ADMIN_PREFIXES; this is a sub-constant for clarity.
 */
export const ANALYTICS_PREFIX = '/analytics/' as const;

/**
 * Key-admin prefixes — X-API-Key auth path (unchanged from F026).
 * Excludes /analytics/ which migrated to bearer-only in ADR-031.
 */
export const KEY_ADMIN_PREFIXES = ['/ingest/', '/quality/', '/embeddings/', '/admin/'] as const;

/**
 * Legacy helper — kept for any consumer that still needs the union check.
 * rateLimit.ts uses ADMIN_PREFIXES (not this function) so this is informational only.
 */
export function isAdminRoute(url: string | undefined, method?: string): boolean {
  if (!url) return false;
  // Method-specific public exemptions (POST beacon route — no auth headers possible)
  if (url === '/analytics/web-events' && method === 'POST') return false;
  // Method-specific admin routes
  if (url === '/restaurants' && method === 'POST') return true;
  // Prefix-based admin routes (existing)
  return ADMIN_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Returns true when the request is an analytics route that uses bearer-only auth (ADR-031).
 * POST /analytics/web-events is excluded — it is a public sendBeacon endpoint that cannot
 * set auth headers. All other /analytics/* paths require bearer + admin tier.
 */
export function isAnalyticsRoute(url: string | undefined, method?: string): boolean {
  if (!url) return false;
  // POST /analytics/web-events is public (sendBeacon — cannot set auth headers)
  if (url === '/analytics/web-events' && method === 'POST') return false;
  return url.startsWith(ANALYTICS_PREFIX);
}

/**
 * Returns true when the request should be gated by X-API-Key (validateAdminKey).
 * Method-aware: POST /restaurants is an admin write (catalog management); GET /restaurants
 * is a public catalog read — so callers do not need to replicate this special case.
 */
export function isKeyAdminRoute(url: string | undefined, method?: string): boolean {
  if (!url) return false;
  // POST /restaurants is admin via key; GET /restaurants is public catalog
  if (url === '/restaurants') return method === 'POST';
  return KEY_ADMIN_PREFIXES.some((prefix) => url.startsWith(prefix));
}
