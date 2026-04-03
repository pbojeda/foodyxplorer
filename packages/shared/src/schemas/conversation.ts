// Zod schemas for the Conversation Core (F070).
//
// ConversationMessageBodySchema   — request body for POST /conversation/message
// ConversationIntentSchema        — enum of domain-level intent outcomes
// ConversationMessageDataSchema   — response data payload (wrapped in success envelope)
// ConversationMessageResponseSchema — full API response envelope

import { z } from 'zod';
import { EstimateDataSchema } from './estimate.js';

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
  'context_set',   // "estoy en mcdonalds" — context set or ambiguous
  'comparison',    // "big mac vs whopper" — two estimation results
  'estimation',    // "big mac" — single estimation result
  'text_too_long', // text > 500 chars after trim (domain rule, not Zod)
]);

export type ConversationIntent = z.infer<typeof ConversationIntentSchema>;

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
