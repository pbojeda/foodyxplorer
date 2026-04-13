// F-UX-B — Standard portion schema (per-dish serving assumption).
//
// Replaces the legacy shape (foodId/context/portionGrams/sourceId) with the
// per-dish portion assumption model: dishId, term, grams, pieces, pieceName,
// confidence, notes. See ADR-020.

import { z } from 'zod';

export const PortionConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type PortionConfidence = z.infer<typeof PortionConfidenceSchema>;

export const PortionTermSchema = z.enum(['pintxo', 'tapa', 'media_racion', 'racion']);
export type PortionTerm = z.infer<typeof PortionTermSchema>;

export const StandardPortionSchema = z.object({
  id: z.string().uuid(),
  dishId: z.string().uuid(),
  term: PortionTermSchema,
  grams: z.number().int().positive(),
  pieces: z.number().int().min(1).nullable(),
  pieceName: z.string().min(1).nullable(),
  confidence: PortionConfidenceSchema,
  notes: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type StandardPortion = z.infer<typeof StandardPortionSchema>;

export const CreateStandardPortionSchema = StandardPortionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).superRefine((data, ctx) => {
  // pieces and pieceName must both be null or both non-null
  if ((data.pieces === null) !== (data.pieceName === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'pieces and pieceName must both be null or both non-null',
      path: ['pieces'],
    });
  }
});
export type CreateStandardPortion = z.infer<typeof CreateStandardPortionSchema>;
