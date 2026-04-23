// ConversationCore — main pipeline for POST /conversation/message (F070, Step 7)
//
// processMessage() implements the 5-step NL pipeline:
//   0. Load context (always first)
//   1. Length guard (> 500 chars → text_too_long)
//   2. Context-set detection
//   3. Comparison detection
//   4. Single-dish estimation
//
// All dependencies are passed via ConversationRequest (full DI, no module-level singletons).

import type { ConversationMessageData, EstimateData, MenuEstimationTotals } from '@foodxplorer/shared';
import type { ConversationRequest, ConversationContext } from './types.js';
import { getContext, setContext } from './contextManager.js';
import { resolveChain } from './chainResolver.js';
import { estimate } from './estimationOrchestrator.js';
import {
  detectContextSet,
  detectReverseSearch,
  extractComparisonQuery,
  extractPortionModifier,
  extractFoodQuery,
  parseDishExpression,
  CONTAINER_PATTERNS,
  POST_COUNT_SERVING_PATTERNS,
} from './entityExtractor.js';
import { detectMenuQuery } from './menuDetector.js';
import { extractDiners } from './dinersExtractor.js';
import { reverseSearchDishes } from '../estimation/reverseSearch.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TEXT_LENGTH = 500;

// ---------------------------------------------------------------------------
// F-NLP-CHAIN-ORDERING: stripContainerResidual
// ---------------------------------------------------------------------------

/**
 * Strip a leading container or non-drink serving prefix from `text`.
 *
 * Called ONLY after `extractPortionModifier` has stripped a count token
 * (i.e., portionMultiplier > 1 or cleanQuery !== strippedQuery). At that
 * point the residual text may start with a container ("platos de", "cuencos de")
 * or a non-drink serving prefix ("tapas de", "raciones de") that must be removed
 * so L1 receives the clean food name.
 *
 * Deliberately does NOT use the full SERVING_FORMAT_PATTERNS — drink-vessel
 * entries like "cañas de", "tercios de" carry food-semantic value and must not
 * be stripped (e.g., "cañas de cerveza" → the food IS "caña de cerveza").
 *
 * Module-private — not exported.
 */
function stripContainerResidual(text: string): string {
  // Pass 1: CONTAINER_PATTERNS (platos de, cuencos de, boles de, vasitos de, ...)
  for (const pattern of CONTAINER_PATTERNS) {
    const stripped = text.replace(pattern, '').trim();
    if (stripped !== text && stripped.length > 0) {
      return stripped;
    }
  }

  // Pass 2: POST_COUNT_SERVING_PATTERNS (tapas de, pinchos de, pintxos de, raciones de)
  for (const pattern of POST_COUNT_SERVING_PATTERNS) {
    const stripped = text.replace(pattern, '').trim();
    if (stripped !== text && stripped.length > 0) {
      return stripped;
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// processMessage
// ---------------------------------------------------------------------------

/**
 * Main entry point for natural language conversation processing.
 *
 * Returns a ConversationMessageData with `intent` and structured fields.
 * Never returns formatted text — callers (bot adapter, web adapter) format.
 */
export async function processMessage(
  req: ConversationRequest,
): Promise<ConversationMessageData> {
  const {
    text,
    actorId,
    db,
    redis,
    prisma,
    openAiApiKey,
    level4Lookup,
    chainSlugs,
    chains,
    logger,
    legacyChainSlug,
    legacyChainName,
  } = req;

  // -------------------------------------------------------------------------
  // Step 0 — Load context (always first, fail-open)
  // -------------------------------------------------------------------------

  let rawContext: ConversationContext | null = null;
  try {
    rawContext = await getContext(actorId, redis);
  } catch {
    // Fail-open: Redis errors → treat as no context
    rawContext = null;
  }

  // Merge conv:ctx with legacy context (conv:ctx takes priority)
  const effectiveContext: ConversationContext | null =
    rawContext ??
    (legacyChainSlug && legacyChainName
      ? { chainSlug: legacyChainSlug, chainName: legacyChainName }
      : null);

  // Build activeContext for response echoing
  const activeContext: ConversationMessageData['activeContext'] =
    effectiveContext?.chainSlug && effectiveContext?.chainName
      ? { chainSlug: effectiveContext.chainSlug, chainName: effectiveContext.chainName }
      : null;

  // -------------------------------------------------------------------------
  // Step 1 — Length guard
  // -------------------------------------------------------------------------

  const trimmed = text.trim();

  if (trimmed.length > MAX_TEXT_LENGTH) {
    return {
      intent: 'text_too_long',
      actorId,
      activeContext,
    };
  }

  // -------------------------------------------------------------------------
  // Step 2 — Context-set detection
  // -------------------------------------------------------------------------

  const chainIdentifier = detectContextSet(trimmed);

  if (chainIdentifier !== null) {
    const resolved = resolveChain(chainIdentifier, chains);

    if (resolved === 'ambiguous') {
      return {
        intent: 'context_set',
        actorId,
        ambiguous: true as const,
        activeContext,
      };
    }

    if (resolved !== null) {
      // Successfully resolved — write to Redis and return
      await setContext(actorId, { chainSlug: resolved.chainSlug, chainName: resolved.chainName }, redis);
      return {
        intent: 'context_set',
        actorId,
        contextSet: { chainSlug: resolved.chainSlug, chainName: resolved.chainName },
        activeContext: { chainSlug: resolved.chainSlug, chainName: resolved.chainName },
      };
    }

    // resolved === null → fall through silently to comparison/estimation
  }

  // -------------------------------------------------------------------------
  // Step 2.5 — Reverse search detection (F086)
  // -------------------------------------------------------------------------

  const reverseSearchParams = detectReverseSearch(trimmed);

  if (reverseSearchParams !== null) {
    if (effectiveContext?.chainSlug) {
      // Clamp values to valid bounds (NL input has no Zod validation)
      const maxCalories = Math.max(100, Math.min(3000, reverseSearchParams.maxCalories));
      const minProtein = reverseSearchParams.minProtein !== undefined
        ? Math.max(0, Math.min(200, reverseSearchParams.minProtein))
        : undefined;

      try {
        const reverseSearch = await reverseSearchDishes(db, {
          chainSlug: effectiveContext.chainSlug,
          maxCalories,
          minProtein,
          limit: 5,
        });

        return {
          intent: 'reverse_search',
          actorId,
          reverseSearch,
          activeContext,
        };
      } catch (err) {
        // DB failure — log and return intent without data (graceful degradation)
        logger.warn({ err }, 'F086: reverse search DB query failed, returning intent without data');
        return {
          intent: 'reverse_search',
          actorId,
          activeContext,
        };
      }
    }

    // No chain context — return reverse_search intent without data
    return {
      intent: 'reverse_search',
      actorId,
      activeContext,
    };
  }

  // -------------------------------------------------------------------------
  // Step 3 — Comparison detection
  // -------------------------------------------------------------------------

  const comparison = extractComparisonQuery(trimmed);

  if (comparison !== null) {
    const { dishA: dishAText, dishB: dishBText, nutrientFocus } = comparison;

    const parsedA = parseDishExpression(dishAText);
    const parsedB = parseDishExpression(dishBText);

    // Inject context fallback for each side if no explicit slug
    const chainSlugA = parsedA.chainSlug ?? effectiveContext?.chainSlug;
    const chainSlugB = parsedB.chainSlug ?? effectiveContext?.chainSlug;

    const [resultA, resultB] = await Promise.allSettled([
      estimate({
        query: parsedA.query,
        chainSlug: chainSlugA,
        portionMultiplier: parsedA.portionMultiplier,
        db,
        prisma,
        openAiApiKey,
        level4Lookup,
        chainSlugs,
        logger,
        originalQuery: dishAText,
      }),
      estimate({
        query: parsedB.query,
        chainSlug: chainSlugB,
        portionMultiplier: parsedB.portionMultiplier,
        db,
        prisma,
        openAiApiKey,
        level4Lookup,
        chainSlugs,
        logger,
        originalQuery: dishBText,
      }),
    ]);

    // Both sides DB error → propagate
    if (resultA.status === 'rejected' && resultB.status === 'rejected') {
      throw resultA.reason instanceof Error ? resultA.reason : new Error(String(resultA.reason));
    }

    // Build null-result EstimateData for rejected sides
    const nullEstimateData = (query: string) => ({
      query,
      chainSlug: null,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: null as null,
      result: null,
      cachedAt: null,
      portionMultiplier: 1,
    });

    const dishA =
      resultA.status === 'fulfilled' ? resultA.value : nullEstimateData(parsedA.query);
    const dishB =
      resultB.status === 'fulfilled' ? resultB.value : nullEstimateData(parsedB.query);

    return {
      intent: 'comparison',
      actorId,
      comparison: {
        dishA,
        dishB,
        nutrientFocus,
      },
      activeContext,
    };
  }

  // -------------------------------------------------------------------------
  // Step 3.5 — Menu estimation (F076)
  // -------------------------------------------------------------------------

  // F089: extract "para N personas" before menu detection so it's not treated as a dish name
  const { diners: detectedDiners, cleanedText: textWithoutDiners } = extractDiners(trimmed);
  const menuItems = detectMenuQuery(textWithoutDiners);

  if (menuItems !== null) {
    const menuResults = await Promise.allSettled(
      menuItems.map((itemText) => {
        const parsed = parseDishExpression(itemText);
        const chainSlugForItem = parsed.chainSlug ?? effectiveContext?.chainSlug;

        return estimate({
          query: parsed.query,
          chainSlug: chainSlugForItem,
          portionMultiplier: parsed.portionMultiplier,
          db,
          prisma,
          openAiApiKey,
          level4Lookup,
          chainSlugs,
          logger,
          originalQuery: itemText,
        });
      }),
    );

    // Check if ALL items rejected with system errors → propagate
    const allRejected = menuResults.every((r) => r.status === 'rejected');
    if (allRejected && menuResults.length > 0) {
      const firstRejected = menuResults.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      throw firstRejected.reason instanceof Error
        ? firstRejected.reason
        : new Error(String(firstRejected.reason));
    }

    // Build items array — rejected promises become null-result EstimateData
    const items = menuItems.map((query, i) => {
      const result = menuResults[i];
      if (!result) throw new Error(`menuResults missing index ${i} — allSettled contract violated`);
      const estimation: EstimateData = result.status === 'fulfilled'
        ? result.value
        : {
            query,
            chainSlug: null,
            level1Hit: false,
            level2Hit: false,
            level3Hit: false,
            level4Hit: false,
            matchType: null,
            result: null,
            cachedAt: null,
            portionMultiplier: 1,
          };
      return { query, estimation };
    });

    // Aggregate totals from matched items
    const totals = aggregateMenuTotals(items);
    const matchedCount = items.filter((item) => item.estimation.result !== null).length;

    // Context fallback: true if any item had no explicit chain slug but context was injected
    const menuUsedContextFallback = menuItems.some((itemText) => {
      const parsed = parseDishExpression(itemText);
      return !parsed.chainSlug && !!effectiveContext?.chainSlug;
    });

    // F089: compute per-person totals if diners were detected
    const diners = detectedDiners ?? null;
    const perPerson = diners !== null ? divideMenuTotals(totals, diners) : null;

    return {
      intent: 'menu_estimation' as const,
      actorId,
      menuEstimation: {
        items,
        totals,
        itemCount: items.length,
        matchedCount,
        diners,
        perPerson,
      },
      activeContext,
      usedContextFallback: menuUsedContextFallback,
    };
  }

  // -------------------------------------------------------------------------
  // Step 4 — Single-dish estimation
  // -------------------------------------------------------------------------

  // F-NLP-CHAIN-ORDERING: reordered pipeline — extractFoodQuery (wrapper strip) FIRST,
  // then extractPortionModifier on stripped text, then stripContainerResidual on residual.
  // Spec EC fallback: if the reordered pipeline throws (e.g., a future regex addition with
  // catastrophic backtracking), fall back to the original single-pass behavior so the
  // endpoint never regresses to 500.
  let extractedQuery: string;
  let portionMultiplier: number;
  let explicitSlug: string | undefined;
  try {
    const stripped = extractFoodQuery(trimmed);
    const modified = extractPortionModifier(stripped.query);
    // Only apply the container/serving residual strip when a count token was actually
    // extracted (i.e., the modifier changed the text). This avoids stripping serving
    // tokens that are part of the food name (e.g., "cañas de cerveza").
    extractedQuery =
      modified.cleanQuery !== stripped.query
        ? stripContainerResidual(modified.cleanQuery)
        : modified.cleanQuery;
    portionMultiplier = modified.portionMultiplier;
    explicitSlug = stripped.chainSlug;
  } catch (err) {
    logger.warn?.({ err }, 'F-NLP-CHAIN-ORDERING: reordered pipeline threw — falling back to single-pass');
    const modified = extractPortionModifier(trimmed);
    const stripped = extractFoodQuery(modified.cleanQuery);
    extractedQuery = stripped.query;
    portionMultiplier = modified.portionMultiplier;
    explicitSlug = stripped.chainSlug;
  }

  // Inject context fallback only when query has no explicit chainSlug
  const effectiveChainSlug = explicitSlug ?? effectiveContext?.chainSlug;

  if (prisma === undefined) {
    logger.debug({}, 'BUG-PROD-006: prisma absent from ConversationRequest — portionAssumption will not resolve');
  }

  const estimationResult = await estimate({
    query: extractedQuery,
    chainSlug: effectiveChainSlug,
    portionMultiplier,
    db,
    prisma,
    openAiApiKey,
    level4Lookup,
    chainSlugs,
    logger,
    originalQuery: trimmed,
  });

  // Track whether context was injected (no explicit slug in query)
  const usedContextFallback = !explicitSlug && !!effectiveContext?.chainSlug;

  return {
    intent: 'estimation',
    actorId,
    estimation: estimationResult,
    activeContext,
    usedContextFallback,
  };
}

// ---------------------------------------------------------------------------
// aggregateMenuTotals — sum nutrients from matched menu items (F076)
// ---------------------------------------------------------------------------

const NUTRIENT_KEYS = [
  'calories', 'proteins', 'carbohydrates', 'sugars',
  'fats', 'saturatedFats', 'fiber', 'salt', 'sodium',
  'transFats', 'cholesterol', 'potassium',
  'monounsaturatedFats', 'polyunsaturatedFats', 'alcohol',
] as const;

function aggregateMenuTotals(
  items: Array<{ query: string; estimation: EstimateData }>,
): MenuEstimationTotals {
  const totals: MenuEstimationTotals = {
    calories: 0, proteins: 0, carbohydrates: 0, sugars: 0,
    fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
    transFats: 0, cholesterol: 0, potassium: 0,
    monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
  };

  for (const item of items) {
    const result = item.estimation.result;
    if (!result) continue;

    const n = result.nutrients;
    for (const key of NUTRIENT_KEYS) {
      totals[key] += n[key];
    }
  }

  // Round totals to 2 decimal places
  for (const key of NUTRIENT_KEYS) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }

  return totals;
}

// ---------------------------------------------------------------------------
// F089 — divide menu totals by N diners (Modo Tapeo)
// ---------------------------------------------------------------------------

function divideMenuTotals(
  totals: MenuEstimationTotals,
  diners: number,
): MenuEstimationTotals {
  const perPerson: MenuEstimationTotals = { ...totals };
  for (const key of NUTRIENT_KEYS) {
    perPerson[key] = Math.round((totals[key] / diners) * 100) / 100;
  }
  return perPerson;
}
