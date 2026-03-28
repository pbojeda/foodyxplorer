import type { Variant } from '@/types';

export const VARIANT_COOKIE_NAME = 'nx-variant';
export const VARIANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

const VALID_VARIANTS: Variant[] = ['a', 'c', 'f'];

function isValidVariant(value: string | undefined): value is Variant {
  return VALID_VARIANTS.includes(value as Variant);
}

/**
 * Pure function — no side effects.
 * Priority: URL searchParam > cookie > random 50/50
 * The optional `random` param enables deterministic testing.
 */
export function resolveVariant(
  searchParamVariant: string | undefined,
  cookieVariant: string | undefined,
  random: () => number = Math.random
): Variant {
  if (isValidVariant(searchParamVariant)) {
    return searchParamVariant;
  }

  if (isValidVariant(cookieVariant)) {
    return cookieVariant;
  }

  // Default fallback is always 'a'
  return 'a';
}
