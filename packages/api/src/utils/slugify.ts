// slugify.ts — Slug generation utilities (F032)

import { randomUUID } from 'node:crypto';

/**
 * Generate a unique chainSlug for independent (non-chain) restaurants.
 *
 * Format: `independent-<name-slug>-<uuid-4>`
 * - name-slug: lowercase, spaces replaced with '-', non-[a-z0-9-] stripped,
 *   multiple consecutive '-' collapsed.
 * - uuid-4: first 4 hex chars of a fresh randomUUID() (collision-resistant
 *   given the small number of independent restaurants per country).
 *
 * @example generateIndependentSlug("McDonald's Burgos")
 *          → "independent-mcdonalds-burgos-3f2a"
 */
export function generateIndependentSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  const uid = randomUUID().replace(/-/g, '').slice(0, 4);
  return `independent-${slug}-${uid}`;
}
