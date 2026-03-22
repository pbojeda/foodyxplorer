// adminPrefixes.ts — Shared admin route prefix constants (F026)
//
// Extracted to avoid circular dependency between auth.ts and rateLimit.ts.
// Both modules import from here instead of from each other.

/** Admin route URL prefixes (trailing slash required for prefix matching) */
export const ADMIN_PREFIXES = ['/ingest/', '/quality/', '/embeddings/', '/analytics/'] as const;

export function isAdminRoute(url: string | undefined): boolean {
  if (!url) return false;
  return ADMIN_PREFIXES.some((prefix) => url.startsWith(prefix));
}
