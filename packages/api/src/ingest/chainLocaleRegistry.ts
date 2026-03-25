// chainLocaleRegistry.ts — Maps chain slugs to the source language of their
// nutritional documents.
//
// Used by ingest routes to decide whether to copy name → name_es at write time.
// Values: 'en' (PDF/scraper source is English), 'es' (source is Spanish).
// If a chain slug is not listed, getChainSourceLocale() returns 'unknown'.

// ---------------------------------------------------------------------------
// Registry — chain slug → source locale of nutritional documents
// ---------------------------------------------------------------------------

export const CHAIN_SOURCE_LOCALE: Record<string, 'en' | 'es'> = {
  'burger-king-es':      'en',  // English PDFs
  'kfc-es':              'en',  // English PDFs
  'five-guys-es':        'en',  // English PDFs
  'subway-es':           'en',  // English PDFs (EU nutritional format)
  'mcdonalds-es':        'en',  // Scraper extracts English names
  'telepizza-es':        'es',  // Spanish PDFs
  'pans-and-company-es': 'es',  // Spanish/Portuguese PDFs (Ibersol)
  'dominos-es':          'es',  // OCR output is Spanish
  'popeyes-es':          'es',  // PDF is in Spanish
  'papa-johns-es':       'es',  // PDF is in Spanish
  'pizza-hut-es':        'es',  // PDF is in Spanish
  'starbucks-es':        'es',  // PDF is in Spanish (per 100g, Spanish language)
  'tim-hortons-es':      'es',  // PDF is in Spanish
};

// ---------------------------------------------------------------------------
// Helper — look up a chain slug, returning 'unknown' for missing/undefined
// ---------------------------------------------------------------------------

export function getChainSourceLocale(
  chainSlug: string | undefined,
): 'en' | 'es' | 'unknown' {
  if (chainSlug === undefined) {
    return 'unknown';
  }
  return CHAIN_SOURCE_LOCALE[chainSlug] ?? 'unknown';
}
