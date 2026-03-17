// Embedding Generation Zod schemas — single source of truth for F019.
//
// Used by:
//   - packages/api/src/routes/embeddings.ts  (route validation)
//   - packages/api/src/scripts/embeddings-generate.ts  (CLI script)
//   - packages/api/src/embeddings/  (pipeline logic)

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

export const EmbeddingTargetSchema = z.enum(['foods', 'dishes', 'all']);
export type EmbeddingTarget = z.infer<typeof EmbeddingTargetSchema>;

export const EmbeddingGenerateRequestSchema = z.object({
  /**
   * Which entity type(s) to embed.
   * - 'foods'  — only the foods table
   * - 'dishes' — only the dishes table
   * - 'all'    — foods first, then dishes
   */
  target: EmbeddingTargetSchema,

  /**
   * Restrict dish embedding to a single restaurant chain.
   * Ignored when target is 'foods'.
   */
  chainSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(100)
    .optional(),

  /**
   * Items per OpenAI API call. OpenAI supports up to 2048 for
   * text-embedding-3-small. Defaults to OPENAI_EMBEDDING_BATCH_SIZE env var.
   */
  batchSize: z.number().int().min(1).max(2048).default(100),

  /**
   * When false, items with an existing non-zero embedding are skipped.
   * When true, all items are re-embedded unconditionally.
   */
  force: z.boolean().default(false),

  /**
   * When true, counts items and estimates tokens but makes no API calls
   * and performs no DB writes.
   */
  dryRun: z.boolean().default(false),
});

export type EmbeddingGenerateRequest = z.infer<typeof EmbeddingGenerateRequestSchema>;

// ---------------------------------------------------------------------------
// Per-item error record
// ---------------------------------------------------------------------------

export const EmbeddingItemTypeSchema = z.enum(['food', 'dish']);
export type EmbeddingItemType = z.infer<typeof EmbeddingItemTypeSchema>;

export const EmbeddingItemErrorSchema = z.object({
  itemType: EmbeddingItemTypeSchema,
  itemId: z.string().uuid(),
  itemName: z.string(),
  reason: z.string(),
});

export type EmbeddingItemError = z.infer<typeof EmbeddingItemErrorSchema>;

// ---------------------------------------------------------------------------
// Response data payload
// ---------------------------------------------------------------------------

export const EmbeddingGenerateDataSchema = z.object({
  target: EmbeddingTargetSchema,
  dryRun: z.boolean(),
  processedFoods: z.number().int().nonnegative(),
  processedDishes: z.number().int().nonnegative(),
  skippedFoods: z.number().int().nonnegative(),
  skippedDishes: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(EmbeddingItemErrorSchema),
  /** Estimated tokens consumed (or that would be consumed in dryRun). */
  estimatedTokens: z.number().int().nonnegative(),
  /** Wall-clock duration of the pipeline in milliseconds. */
  durationMs: z.number().int().nonnegative(),
  /** ISO-8601 timestamp when the pipeline finished. */
  completedAt: z.string(),
});

export type EmbeddingGenerateData = z.infer<typeof EmbeddingGenerateDataSchema>;

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

export const EmbeddingGenerateResponseSchema = z.object({
  success: z.literal(true),
  data: EmbeddingGenerateDataSchema,
});

export type EmbeddingGenerateResponse = z.infer<typeof EmbeddingGenerateResponseSchema>;
