'use client';

// F-ADMIN-ANALYTICS-UI — i18n-light hook.
// Scope: admin panel only. No async loading, no interpolation built-in.
// Interpolation is caller responsibility: t('key').replace('{count}', String(n)).
//
// Key contract: returns the key string itself when a key is missing or the resolved
// value is not a string. Never throws.

import adminMessages from './messages/es/admin.json';

const NAMESPACES: Record<string, Record<string, unknown>> = {
  admin: adminMessages as Record<string, unknown>,
};

/**
 * Returns a translation function `t(key: string): string` for the given namespace.
 *
 * - Keys are dot-separated: `'panel.missedQueries.title'`
 * - Falls back to the key string if: namespace unknown, key missing, or resolved value
 *   is not a string (e.g. resolves to an object node).
 * - Does NOT support interpolation — callers use `.replace('{x}', val)`.
 */
export function useT(namespace: string): (key: string) => string {
  const messages = NAMESPACES[namespace] ?? {};

  return function t(key: string): string {
    const parts = key.split('.');
    let current: unknown = messages;
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'string' ? current : key;
  };
}
