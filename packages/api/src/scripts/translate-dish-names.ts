// translate-dish-names.ts — CLI script to populate name_es and
// name_source_locale for all dishes via batch LLM translation.
//
// Usage:
//   npm run translate:dish-names -w @foodxplorer/api [-- --dry-run]
//   npm run translate:dish-names -w @foodxplorer/api [-- --chain burger-king-es]
//   npm run translate:dish-names -w @foodxplorer/api [-- --batch-size 25]
//   npm run translate:dish-names -w @foodxplorer/api [-- --force]
//
// Exports runTranslateDishNames() for testability via DI.
// Exports classifyDishName() as a pure, separately-testable function.
// The isMain guard prevents execution when imported in tests.

import type { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { prisma as defaultPrisma } from '../lib/prisma.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranslateDishNamesOptions {
  dryRun: boolean;
  chainSlug?: string;
  batchSize: number;
  force: boolean;
}

export type ClassificationAction =
  | 'brand_copy'
  | 'es_copy'
  | 'short_copy'
  | 'mixed_copy'
  | 'code_copy'
  | 'llm_translate';

export interface ClassificationResult {
  action: ClassificationAction;
  nameEs?: string;
  nameSourceLocale: 'en' | 'es' | 'mixed' | 'unknown';
}

export interface TranslationSummary {
  total: number;
  brandCopy: number;
  esCopy: number;
  shortCopy: number;
  mixedCopy: number;
  codeCopy: number;
  translated: number;
  failed: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Brand names — known proper nouns that should be copied verbatim
// ---------------------------------------------------------------------------

export const BRAND_NAMES: ReadonlySet<string> = new Set([
  'Whopper',
  'Big Mac',
  'McFlurry',
  "Croissan'wich",
  'McRib',
  'Happy Meal',
  'Big King',
  'Quarter Pounder',
  'Filet-O-Fish',
  'Royale',
  'Double Down',
  'Zinger',
  'Twister',
  'Crunchy',
  'Original Recipe',
  'Popcorn Chicken',
  'Big Crunch',
  'Chicken Littles',
  'Famous Bowl',
  'Mac Jr',
  'McChicken',
  'McNuggets',
  'McCafe',
  'McDouble',
  'McWrap',
  'Mozzarella Dippers',
  'Chicken Select',
]);

// ---------------------------------------------------------------------------
// Spanish indicator words for heuristic detection
// ---------------------------------------------------------------------------

// Words that are unambiguously Spanish (not shared with English/Italian).
// Excluded: pizza (Italian/English), salsa (English loanword), menu/menú (English cognate).
const SPANISH_INDICATOR_WORDS = [
  'con',
  'de',
  'del',
  'al',
  'sin',
  'pollo',
  'ternera',
  'jamón',
  'jamon',
  'queso',
  'ensalada',
  'patatas',
  'pechuga',
  'bocadillo',
  'refresco',
];

// ---------------------------------------------------------------------------
// classifyDishName — pure function, no side effects
// ---------------------------------------------------------------------------

/**
 * Classify a dish name and determine the appropriate translation action.
 * Returns a ClassificationResult with the action, proposed nameEs, and locale.
 *
 * Classification steps:
 * 1. Brand name detection (substring, whole-word, case-insensitive)
 * 2. Mixed-language detection (separator pattern)
 * 3. Already-Spanish detection (2+ Spanish indicator words)
 * 4. Short/ambiguous detection (≤3 chars)
 * 5. Code/non-alpha detection (all non-alpha tokens)
 * 6. LLM translation (all remaining English names)
 */
export function classifyDishName(
  name: string,
  _chainSlug: string | undefined,
  brandNames: ReadonlySet<string>,
): ClassificationResult {
  // Step 1 — Brand name detection
  for (const brand of brandNames) {
    // Whole-word boundary match, case-insensitive
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s|\\b)${escaped}(?:\\s|\\b|$)`, 'i');
    if (regex.test(name)) {
      return {
        action: 'brand_copy',
        nameEs: name,
        nameSourceLocale: 'en',
      };
    }
  }

  // Step 2 — Mixed-language detection (contains " / " separator pattern)
  if (/ \/ /.test(name)) {
    return {
      action: 'mixed_copy',
      nameEs: name,
      nameSourceLocale: 'mixed',
    };
  }

  // Step 3 — Already-Spanish detection (2+ Spanish indicator words)
  const nameLower = name.toLowerCase();
  let spanishWordCount = 0;
  for (const word of SPANISH_INDICATOR_WORDS) {
    const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
    if (wordRegex.test(nameLower)) {
      spanishWordCount++;
      if (spanishWordCount >= 2) {
        return {
          action: 'es_copy',
          nameEs: name,
          nameSourceLocale: 'es',
        };
      }
    }
  }

  // Step 4 — Short/ambiguous detection (≤3 chars after trim)
  if (name.trim().length <= 3) {
    return {
      action: 'short_copy',
      nameEs: name,
      nameSourceLocale: 'unknown',
    };
  }

  // Step 5 — Code/non-alpha detection (composed entirely of non-alpha tokens)
  // A token is non-alpha if it contains no letters at all
  const tokens = name.trim().split(/\s+/);
  const allNonAlpha = tokens.length > 0 && tokens.every((token) => !/[a-zA-ZÀ-ÿ]/.test(token));
  if (allNonAlpha) {
    return {
      action: 'code_copy',
      nameEs: name,
      nameSourceLocale: 'unknown',
    };
  }

  // Step 6 — LLM translation (descriptive English name)
  return {
    action: 'llm_translate',
    nameSourceLocale: 'en',
  };
}

// ---------------------------------------------------------------------------
// OpenAI system prompt
// ---------------------------------------------------------------------------

const TRANSLATION_SYSTEM_PROMPT = `You are a food translator. Translate the following restaurant dish names from English to Spanish.
Rules:
- Proper nouns and brand names (e.g., "Big Mac", "Whopper", "McFlurry") must be kept as-is.
- Translate descriptive terms accurately (e.g., "Grilled Chicken Salad" → "Ensalada de Pollo a la Plancha").
- Preserve capitalization style of the original.
- Return ONLY a JSON array of translated strings, in the same order as input.
- Do NOT add explanations.`;

// ---------------------------------------------------------------------------
// runTranslateDishNames — DI-friendly main function
// ---------------------------------------------------------------------------

/**
 * Run the batch translation pipeline.
 *
 * @param opts           - Parsed CLI options
 * @param prismaOverride - Optional PrismaClient for testing (defaults to singleton)
 */
export async function runTranslateDishNames(
  opts: TranslateDishNamesOptions,
  prismaOverride?: PrismaClient,
): Promise<TranslationSummary> {
  const prismaClient = prismaOverride ?? defaultPrisma;

  // Build Prisma query filters
  const where: Record<string, unknown> = {};
  if (!opts.force) {
    where['nameEs'] = null;
  }
  if (opts.chainSlug !== undefined) {
    where['restaurant'] = { chainSlug: opts.chainSlug };
  }

  const dishes = await prismaClient.dish.findMany({
    where,
    include: { restaurant: { select: { chainSlug: true } } },
  });

  const total = dishes.length;
  console.log(`[translate-dish-names] Starting: ${total} dishes to process`);

  const summary: TranslationSummary = {
    total,
    brandCopy: 0,
    esCopy: 0,
    shortCopy: 0,
    mixedCopy: 0,
    codeCopy: 0,
    translated: 0,
    failed: 0,
    skipped: 0,
  };

  // Classify all dishes locally
  const brandDishes: typeof dishes = [];
  const esDishes: typeof dishes = [];
  const shortDishes: typeof dishes = [];
  const mixedDishes: typeof dishes = [];
  const codeDishes: typeof dishes = [];
  const llmDishes: typeof dishes = [];

  for (const dish of dishes) {
    const chainSlug = dish.restaurant?.chainSlug ?? undefined;
    const classification = classifyDishName(dish.name, chainSlug, BRAND_NAMES);

    switch (classification.action) {
      case 'brand_copy':
        brandDishes.push(dish);
        break;
      case 'es_copy':
        esDishes.push(dish);
        break;
      case 'short_copy':
        shortDishes.push(dish);
        break;
      case 'mixed_copy':
        mixedDishes.push(dish);
        break;
      case 'code_copy':
        codeDishes.push(dish);
        break;
      case 'llm_translate':
        llmDishes.push(dish);
        break;
    }
  }

  console.log(`[translate-dish-names] Step 1: ${brandDishes.length} brand names → copied as-is`);
  console.log(`[translate-dish-names] Step 2: ${esDishes.length} already-Spanish names → copied as-is`);
  console.log(`[translate-dish-names] Step 3: ${shortDishes.length + mixedDishes.length + codeDishes.length} short/ambiguous/code/mixed names → copied as-is`);
  console.log(`[translate-dish-names] Step 4: ${llmDishes.length} names to translate via gpt-4o-mini`);

  if (opts.dryRun) {
    console.log('[translate-dish-names] Dry-run mode — no writes will be made');
    summary.brandCopy = brandDishes.length;
    summary.esCopy = esDishes.length;
    summary.shortCopy = shortDishes.length;
    summary.mixedCopy = mixedDishes.length;
    summary.codeCopy = codeDishes.length;
    summary.skipped = total;
    return summary;
  }

  // Write non-LLM dishes immediately
  const nonLlmBuckets: Array<{
    bucket: typeof dishes;
    nameSourceLocale: 'en' | 'es' | 'mixed' | 'unknown';
    countKey: keyof TranslationSummary;
  }> = [
    { bucket: brandDishes, nameSourceLocale: 'en', countKey: 'brandCopy' },
    { bucket: esDishes, nameSourceLocale: 'es', countKey: 'esCopy' },
    { bucket: shortDishes, nameSourceLocale: 'unknown', countKey: 'shortCopy' },
    { bucket: mixedDishes, nameSourceLocale: 'mixed', countKey: 'mixedCopy' },
    { bucket: codeDishes, nameSourceLocale: 'unknown', countKey: 'codeCopy' },
  ];

  for (const { bucket, nameSourceLocale, countKey } of nonLlmBuckets) {
    for (const dish of bucket) {
      try {
        await prismaClient.dish.update({
          where: { id: dish.id },
          data: { nameEs: dish.name, nameSourceLocale },
        });
        (summary[countKey] as number)++;
      } catch (err) {
        console.error(`[translate-dish-names] DB write failed for dish ${dish.id}:`, err);
        summary.failed++;
      }
    }
  }

  if (llmDishes.length === 0) {
    console.log(`[translate-dish-names] Done: ${total - summary.failed} succeeded, ${summary.failed} failed`);
    return summary;
  }

  // Validate API key only when LLM translation is needed
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is not set. Cannot initialize OpenAI client.',
    );
  }

  // Initialize OpenAI client
  const openai = new OpenAI({ apiKey });

  // Process LLM dishes in batches
  const batchSize = opts.batchSize;
  const batches: (typeof llmDishes)[] = [];
  for (let i = 0; i < llmDishes.length; i += batchSize) {
    batches.push(llmDishes.slice(i, i + batchSize));
  }

  let totalCostTokens = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    if (!batch) throw new Error(`batches[${batchIdx}] unexpectedly undefined — array length invariant violated`);
    const names = batch.map((d) => d.name);
    console.log(
      `[translate-dish-names] Translating batch ${batchIdx + 1}/${batches.length} (${names.length} names)...`,
    );

    let response: string | null = null;
    let success = false;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(names) },
          ],
        });

        const content = completion.choices[0]?.message.content ?? null;

        if (completion.usage) {
          totalCostTokens += completion.usage.total_tokens;
        }

        response = content;
        success = true;
        break;
      } catch (err) {
        const isRetryable =
          err instanceof Error &&
          (err.message.includes('429') || /\b5\d{2}\b/.test(err.message));

        if (attempt < maxAttempts && isRetryable) {
          const delay = Math.pow(2, attempt - 1) * 2000;
          console.warn(
            `[translate-dish-names] Batch ${batchIdx + 1} attempt ${attempt} failed, retrying in ${delay}ms...`,
          );
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        } else {
          console.error(`[translate-dish-names] Batch ${batchIdx + 1} failed:`, err);
          break;
        }
      }
    }

    if (!success || response === null) {
      console.error(`[translate-dish-names] Batch ${batchIdx + 1} failed — skipping ${names.length} dishes`);
      summary.failed += names.length;
      continue;
    }

    // Parse response
    let parsed: unknown;
    try {
      parsed = JSON.parse(response);
    } catch {
      console.error(`[translate-dish-names] Batch ${batchIdx + 1} JSON parse failure — skipping ${names.length} dishes`);
      summary.failed += names.length;
      continue;
    }

    // Validate response is an array with matching length
    if (!Array.isArray(parsed) || parsed.length !== names.length) {
      console.error(
        `[translate-dish-names] Batch ${batchIdx + 1} array length mismatch (expected ${names.length}, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}) — skipping`,
      );
      summary.failed += names.length;
      continue;
    }

    // Write translated dishes
    for (let i = 0; i < batch.length; i++) {
      const dish = batch[i];
      if (!dish) throw new Error(`batch[${i}] unexpectedly undefined — array length invariant violated`);
      const translatedName = parsed[i];

      if (typeof translatedName !== 'string') {
        console.error(`[translate-dish-names] Invalid translation for dish ${dish.id} — skipping`);
        summary.failed++;
        continue;
      }

      try {
        await prismaClient.dish.update({
          where: { id: dish.id },
          data: { nameEs: translatedName, nameSourceLocale: 'en' },
        });
        summary.translated++;
      } catch (err) {
        console.error(`[translate-dish-names] DB write failed for dish ${dish.id}:`, err);
        summary.failed++;
      }
    }
  }

  // Estimate cost (gpt-4o-mini: ~$0.15/1M input, $0.60/1M output — approximate combined)
  const estimatedCostUsd = (totalCostTokens / 1_000_000) * 0.375;
  console.log(
    `[translate-dish-names] Done: ${total - summary.failed - summary.skipped} succeeded, ${summary.failed} failed`,
  );
  console.log(
    `[translate-dish-names] Estimated cost: ~$${estimatedCostUsd.toFixed(2)}`,
  );

  return summary;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): TranslateDishNamesOptions {
  let dryRun = false;
  let chainSlug: string | undefined;
  let batchSize = 50;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--chain' && args[i + 1] !== undefined) {
      chainSlug = args[i + 1];
      i++;
    } else if (arg === '--batch-size' && args[i + 1] !== undefined) {
      const parsed = parseInt(args[i + 1] ?? '', 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 500) {
        batchSize = parsed;
      }
      i++;
    }
  }

  return { dryRun, chainSlug, batchSize, force };
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when this file is executed directly
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  try {
    const summary = await runTranslateDishNames(opts);
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    const exitCode = summary.failed > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[translate-dish-names] Fatal error: ${message}\n`);
    process.exit(2);
  }
}

// Only run main() when invoked directly (not when imported in tests)
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('translate-dish-names.ts') ||
    process.argv[1].endsWith('translate-dish-names.js'));

if (isMain) {
  void main();
}
