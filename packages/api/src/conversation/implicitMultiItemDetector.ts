// F-MULTI-ITEM-IMPLICIT — Implicit multi-item detection (post-NLP wrapper strip).
//
// Receives the F-NLP wrapper-stripped text (output of extractFoodQuery(textWithoutDiners).query)
// and performs a catalog-validated split. Returns an array of ≥2 dish-name strings if the
// query is implicitly multi-item, or null if it is single-dish / cannot be confirmed.
//
// Strategy D: Whole-text L1 guard (Guard 2) + per-fragment L1 validation (Step 3).
// Guard 1 (no conjunction) is an O(n) short-circuit that avoids any DB call for the majority
// of queries. Guard 2 (whole-text L1 lookup) catches all catalog landmines whose full name
// contains ' y ' or ',' (e.g. "tostada con tomate y aceite", "bocadillo de bacon y queso").
// Per-fragment validation confirms each split fragment is a real catalog item.
//
// ADR-022: explicit catalog membership (DB lookup) > heuristic pattern matching.
// ADR-001: db is Kysely<DB>, NOT PrismaClient — consistent with estimation pipeline.

import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import { level1Lookup } from '../estimation/level1Lookup.js';
import { ARTICLE_PATTERN, SERVING_FORMAT_PATTERNS } from './entityExtractor.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Module-private — NOT imported from menuDetector.ts, NOT re-exported (plan §F).
// Consistent with F076 behaviour: items beyond index 7 are silently dropped.
const MAX_MENU_ITEMS = 8;

// ---------------------------------------------------------------------------
// Helper: splitOnYRecursive
// Recursively splits a fragment on ' y ' until no fragment contains ' y '.
// Uses last-y split to produce left + right, then recurses on each half.
// EC-4: handles multiple ' y ' tokens (e.g. "paella y vino y flan" → ["paella","vino","flan"])
//
// Recursion depth bound: equals the count of ' y ' tokens in the fragment.
// `processMessage` enforces MAX_TEXT_LENGTH = 500 chars upstream (conversationCore.ts:36),
// so worst-case ≈125 ' y ' tokens (3-char delimiter + ≥1-char body) ≈ 125 stack frames.
// Safe for V8/Node default stack sizes (~10k frames). No iterative rewrite needed.
// ---------------------------------------------------------------------------

function splitOnYRecursive(fragment: string): string[] {
  const lastY = fragment.lastIndexOf(' y ');
  if (lastY === -1) return [fragment];
  const left = fragment.slice(0, lastY).trim();
  const right = fragment.slice(lastY + 3).trim();
  // Recurse: left may still contain ' y ' (e.g. "paella y vino" from "paella y vino y flan")
  return [...splitOnYRecursive(left), right];
}

// ---------------------------------------------------------------------------
// Exported helper: splitOnCommasThenYRecursive
// Split on commas first, then recursively split any fragment that still contains ' y '.
// ---------------------------------------------------------------------------

export function splitOnCommasThenYRecursive(text: string): string[] {
  // Split on commas, trim each fragment, discard empty fragments
  const byComma = text.split(',').map((s) => s.trim()).filter(Boolean);

  // For each comma fragment, recursively split on ALL ' y ' tokens
  const result: string[] = [];
  for (const fragment of byComma) {
    result.push(...splitOnYRecursive(fragment));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exported helper: normalizeFragment
// Strip leading articles and serving-format prefixes from a fragment.
// Reuses ARTICLE_PATTERN and SERVING_FORMAT_PATTERNS exported from entityExtractor.ts.
// ---------------------------------------------------------------------------

export function normalizeFragment(text: string): string {
  let s = text.trim();
  // Strip leading article (un/una/unos/unas/el/la/las/los/del/al)
  s = s.replace(ARTICLE_PATTERN, '');
  // Strip leading serving-format prefix (ración de, copa de, etc.) — first match wins
  for (const p of SERVING_FORMAT_PATTERNS) {
    const stripped = s.replace(p, '');
    if (stripped !== s && stripped.trim().length > 0) {
      s = stripped.trim();
      break;
    }
  }
  return s.trim();
}

// ---------------------------------------------------------------------------
// Main export: detectImplicitMultiItem
//
// Receives wrapper-stripped text and db (Kysely instance).
// Returns string[] of ≥2 normalized dish names, or null.
//
// Guards:
//   0. db unavailable → null (defensive safety check; db is always present in production)
//   1. No ' y ' or ',' in text → null (O(n), no DB calls)
//   2. Whole-text L1 lookup returns non-null → null (single catalog dish with conjunction in name)
//
// Algorithm (per spec §3 pseudocode):
//   Step 1: splitOnCommasThenYRecursive(text)
//   Step 2: normalizeFragment per fragment
//   Slice to MAX_MENU_ITEMS BEFORE catalog validation (EC-6, R2-I2)
//   Step 3: per-fragment level1Lookup; any miss → return null
//   Return fragmentsToValidate if all confirmed
// ---------------------------------------------------------------------------

export async function detectImplicitMultiItem(
  text: string,
  db: Kysely<DB>,
): Promise<string[] | null> {
  // Guard 0: defensive null/undefined check (EC-13).
  // Per ConversationRequest contract `db: Kysely<DB>` is always a valid Kysely instance
  // in production; null/undefined here indicates a misconfigured caller (rare unit-test
  // harness only). The `!db` form intentionally also rejects 0/''/false even though
  // those aren't valid Kysely values — keeps the check explicit and removable-by-typecheck.
  if (db === null || db === undefined) return null;

  // Guard 1: quick shape pre-check — only proceed if text contains ' y ' or ','
  // O(n) string check — avoids any DB call for the majority of queries.
  if (!text.includes(' y ') && !text.includes(',')) return null;

  // Guard 2: whole-text catalog match — if the ENTIRE text resolves as a catalog dish
  // via L1 exact+FTS lookup, it is a single-dish query. Return null.
  // This is the primary landmine guard for all ' y '-containing catalog dish names.
  const wholeHit = await level1Lookup(db, text, {});
  if (wholeHit !== null) return null;

  // Step 1: split candidate — comma-then-y-recursive strategy.
  const rawFragments = splitOnCommasThenYRecursive(text);
  if (rawFragments.length < 2) return null;

  // Step 2: normalize each fragment — strip leading articles and serving-format prefixes.
  const normalizedFragments = rawFragments.map(normalizeFragment);

  // R2-I2 fix — slice to MAX_MENU_ITEMS BEFORE catalog validation, so items beyond index 7
  // are silently dropped (consistent with F076 behaviour at menuDetector.ts:101-104) rather
  // than causing the whole detection to fail.
  const fragmentsToValidate = normalizedFragments.slice(0, MAX_MENU_ITEMS);

  // Step 3: catalog validation — every fragment that survived the cap must resolve via
  // L1 exact+FTS lookup. Sequential calls; N ≤ MAX_MENU_ITEMS = 8.
  for (const fragment of fragmentsToValidate) {
    const hit = await level1Lookup(db, fragment, {});
    if (hit === null) return null; // fragment not in catalog → not a multi-item query
  }

  return fragmentsToValidate;
}
