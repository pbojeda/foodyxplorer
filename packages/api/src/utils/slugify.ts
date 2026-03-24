// slugify.ts — Slug generation utilities (F032)

import { randomUUID } from 'node:crypto';

/**
 * Generate a unique chainSlug for independent (non-chain) restaurants.
 *
 * Format: `independent-<name-slug>-<uuid-8>`
 * - name-slug: lowercase, spaces replaced with '-', non-[a-z0-9-] stripped,
 *   multiple consecutive '-' collapsed, leading/trailing '-' removed.
 *   Falls back to 'unnamed' if all characters are stripped.
 * - uuid-8: first 8 hex chars of a fresh randomUUID() (~4 billion combinations).
 *
 * @example generateIndependentSlug("McDonald's Burgos")
 *          → "independent-mcdonalds-burgos-3f2a1b9c"
 */
export function generateIndependentSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';
  const uid = randomUUID().replace(/-/g, '').slice(0, 8);
  return `independent-${slug}-${uid}`;
}
