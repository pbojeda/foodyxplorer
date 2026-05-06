// Zod schemas for the Conversation Core (F070).
//
// ConversationMessageBodySchema   — request body for POST /conversation/message
// ConversationIntentSchema        — enum of domain-level intent outcomes
// ConversationMessageDataSchema   — response data payload (wrapped in success envelope)
// ConversationMessageResponseSchema — full API response envelope
//
// F-MULTITURN-001 additions:
// NutrientKeySchema               — derived from EstimateNutrientsSchema.shape (DRY, R6 fix)
// ConversationTurnStateSchema     — Redis turn-state shape (conv:turn:{actorId})
// FollowUpAttributeDataSchema     — payload for intent=follow_up_attribute
// FollowUpRefinementDataSchema    — payload for intent=follow_up_refinement
// FollowUpMetaSchema              — observability metadata for follow-up intents

import { z } from 'zod';
import { EstimateDataSchema, EstimateNutrientsSchema } from './estimate.js';
import { MenuEstimationDataSchema } from './menuEstimation.js';
import { ReverseSearchDataSchema } from './reverseSearch.js';

// ---------------------------------------------------------------------------
// NutrientKeySchema — derived from EstimateNutrientsSchema, excludes referenceBasis
// (F-MULTITURN-001, R6 DRY fix — never hardcode the list; derive at module load time)
// ---------------------------------------------------------------------------

const _nutrientKeys = Object.keys(EstimateNutrientsSchema.shape).filter(
  (k) => k !== 'referenceBasis',
) as [string, ...string[]];

// Runtime guard: if EstimateNutrientsSchema ever has 0 non-referenceBasis keys, something is wrong.
if (_nutrientKeys.length === 0) {
  throw new Error('EstimateNutrientsSchema has no keys besides referenceBasis — NutrientKeySchema cannot be derived');
}

export const NutrientKeySchema = z.enum(_nutrientKeys as [string, ...string[]]);
export type NutrientKey = z.infer<typeof NutrientKeySchema>;

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

export const ConversationMessageBodySchema = z.object({
  // Raw user text. Zod trims + enforces min/max bounds.
  // Domain rule (> 500 chars) is enforced inside processMessage(), not here.
  text: z.string().trim().min(1).max(2000),

  // Legacy context passthrough from bot:state:{chatId}.chainContext.
  // The bot adapter reads the old state key and passes it here as a fallback
  // when conv:ctx:{actorId} is empty (bridges gap until /contexto is migrated).
  chainSlug: z.string().optional(),
  chainName: z.string().optional(),
});

export type ConversationMessageBody = z.infer<typeof ConversationMessageBodySchema>;

// ---------------------------------------------------------------------------
// Intent enum
// ---------------------------------------------------------------------------

export const ConversationIntentSchema = z.enum([
  'context_set',          // "estoy en mcdonalds" — context set or ambiguous
  'comparison',           // "big mac vs whopper" — two estimation results
  'menu_estimation',      // "menú del día: X, Y, Z" — multi-dish meal (F076)
  'estimation',           // "big mac" — single estimation result
  'reverse_search',       // F086: "qué como con 600 kcal" — filter by calorie/protein constraints
  'text_too_long',        // text > 500 chars after trim (domain rule, not Zod)
  'follow_up_attribute',  // F-MULTITURN-001: "y los carbs?" — nutrient from prior estimation
  'follow_up_refinement', // F-MULTITURN-001: "hazlo de pollo" — re-estimate with modification
]);

export type ConversationIntent = z.infer<typeof ConversationIntentSchema>;

// ---------------------------------------------------------------------------
// ConversationTurnState — Redis turn-state shape (F-MULTITURN-001)
// Key: conv:turn:{actorId}, TTL: 1800s (30 min)
// ---------------------------------------------------------------------------

export const ConversationTurnStateSchema = z.object({
  // The clean food query that was estimated (post-extraction, pre-multiplier text)
  query: z.string().min(1).max(255),
  // chainSlug that was effective for the estimation (null if generic)
  chainSlug: z.string().nullable(),
  // The full EstimateData result from the previous turn.
  // ALWAYS the full EstimateData wrapper — the nullability of "no match" is
  // carried by estimation.result (which is itself nullable in EstimateDataSchema).
  // (R3 fix — Codex IMPORTANT R3-1: do NOT use EstimateDataSchema.nullable())
  estimation: EstimateDataSchema,
  // portionMultiplier used in the previous turn
  portionMultiplier: z.number().min(0.1).max(5.0),
  // Unix timestamp (ms) when this turn was stored, for observability
  storedAt: z.number().int().positive(),
});

export type ConversationTurnState = z.infer<typeof ConversationTurnStateSchema>;

// ---------------------------------------------------------------------------
// Follow-up response schemas (F-MULTITURN-001)
// ---------------------------------------------------------------------------

// Present when intent = 'follow_up_attribute'
export const FollowUpAttributeDataSchema = z.object({
  // The nutrient that was requested — derived from EstimateNutrientsSchema (DRY, R6 fix)
  nutrientKey: NutrientKeySchema,
  // Friendly display name for the nutrient in Spanish
  nutrientLabel: z.string(),
  // The numeric value from the prior EstimateData
  value: z.number().nonnegative(),
  // Unit: 'kcal' | 'g' | 'mg'
  unit: z.enum(['kcal', 'g', 'mg']),
  // The dish name pulled from estimation.result.nameEs ?? estimation.result.name
  dishName: z.string(),
  // The exact prevTurn.query value that resolved this follow-up.
  // (Plan-R4 fix: avoids relying on prevTurn.query === prevTurn.estimation.query invariant)
  priorTurnQuery: z.string().min(1).max(255),
  // The full prior EstimateData for client rendering
  priorEstimation: EstimateDataSchema,
});

export type FollowUpAttributeData = z.infer<typeof FollowUpAttributeDataSchema>;

// Present when intent = 'follow_up_refinement'
export const FollowUpRefinementDataSchema = z.object({
  // The original query from the previous turn
  originalQuery: z.string(),
  // The merged query submitted to the estimation cascade
  mergedQuery: z.string(),
  // The full EstimateData from the re-estimation
  estimation: EstimateDataSchema,
});

export type FollowUpRefinementData = z.infer<typeof FollowUpRefinementDataSchema>;

// Present on any follow_up_* intent — metadata for observability
export const FollowUpMetaSchema = z.object({
  // Which classifier fired
  classifierType: z.enum(['attribute', 'refinement']),
  // Confidence score from the classifier (0.0–1.0)
  confidence: z.number().min(0).max(1),
  // Whether turn state was loaded from Redis (false if cache miss caused fallback)
  turnStateHit: z.boolean(),
});

export type FollowUpMeta = z.infer<typeof FollowUpMetaSchema>;

// ---------------------------------------------------------------------------
// Response data payload
// ---------------------------------------------------------------------------

export const ConversationMessageDataSchema = z.object({
  intent: ConversationIntentSchema,

  // UUID of the resolved actor (from F069 middleware — echoed for traceability)
  actorId: z.string().uuid(),

  // Present when intent = 'context_set' AND chain was resolved (not ambiguous)
  contextSet: z
    .object({
      chainSlug: z.string(),
      chainName: z.string(),
    })
    .optional(),

  // Present when intent = 'context_set' AND chain was ambiguous (contextSet absent)
  ambiguous: z.literal(true).optional(),

  // Present when intent = 'estimation'
  estimation: EstimateDataSchema.optional(),

  // Present when intent = 'comparison'
  comparison: z
    .object({
      dishA: EstimateDataSchema,
      dishB: EstimateDataSchema,
      nutrientFocus: z.string().optional(),
    })
    .optional(),

  // Present when intent = 'menu_estimation' (F076)
  menuEstimation: MenuEstimationDataSchema.optional(),

  // Present when intent = 'reverse_search' (F086)
  reverseSearch: ReverseSearchDataSchema.optional(),

  // Active chain context echoed in ALL responses (null if none set).
  // Loaded BEFORE intent resolution so even text_too_long echoes context.
  activeContext: z
    .object({
      chainSlug: z.string(),
      chainName: z.string(),
    })
    .nullable(),

  // True when chainSlug was injected from context (not explicit in query).
  // Bot adapter uses this to conditionally show "Contexto activo: X" footer.
  // Only meaningful for estimation/comparison intents; absent otherwise.
  usedContextFallback: z.boolean().optional(),

  // Present when intent = 'follow_up_attribute' (F-MULTITURN-001)
  followUpAttribute: FollowUpAttributeDataSchema.optional(),

  // Present when intent = 'follow_up_refinement' (F-MULTITURN-001)
  followUpRefinement: FollowUpRefinementDataSchema.optional(),

  // Present on any follow_up_* intent — observability metadata (F-MULTITURN-001)
  followUpMeta: FollowUpMetaSchema.optional(),
});

export type ConversationMessageData = z.infer<typeof ConversationMessageDataSchema>;

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

export const ConversationMessageResponseSchema = z.object({
  success: z.literal(true),
  data: ConversationMessageDataSchema,
});

export type ConversationMessageResponse = z.infer<typeof ConversationMessageResponseSchema>;
