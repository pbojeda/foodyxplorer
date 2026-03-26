// Zod schemas for the Menu Analysis endpoint (F034).
//
// AnalyzeMenuModeSchema     — enum of processing modes
// AnalyzeMenuBodySchema     — multipart request body fields (mode only; file handled by Fastify)
// MenuAnalysisDishSchema    — single dish result with estimate
// MenuAnalysisDataSchema    — full response data payload
// MenuAnalysisResponseSchema — API response envelope

import { z } from 'zod';
import { EstimateDataSchema } from './estimate.js';

// ---------------------------------------------------------------------------
// AnalyzeMenuModeSchema — the four processing modes
// ---------------------------------------------------------------------------

export const AnalyzeMenuModeSchema = z.enum(['auto', 'ocr', 'vision', 'identify']);

export type AnalyzeMenuMode = z.infer<typeof AnalyzeMenuModeSchema>;

// ---------------------------------------------------------------------------
// AnalyzeMenuBodySchema — multipart fields (file validated by Fastify multipart)
// ---------------------------------------------------------------------------

export const AnalyzeMenuBodySchema = z.object({
  mode: AnalyzeMenuModeSchema.default('auto'),
});

export type AnalyzeMenuBody = z.infer<typeof AnalyzeMenuBodySchema>;

// ---------------------------------------------------------------------------
// MenuAnalysisDishSchema — single dish result
// ---------------------------------------------------------------------------

export const MenuAnalysisDishSchema = z.object({
  dishName: z.string().min(1).max(255),
  estimate: EstimateDataSchema.nullable(),
});

export type MenuAnalysisDish = z.infer<typeof MenuAnalysisDishSchema>;

// ---------------------------------------------------------------------------
// MenuAnalysisDataSchema — full response data payload
// ---------------------------------------------------------------------------

export const MenuAnalysisDataSchema = z.object({
  mode: AnalyzeMenuModeSchema,
  dishCount: z.number().int().min(1),
  dishes: z.array(MenuAnalysisDishSchema).min(1),
  partial: z.boolean().default(false),
});

export type MenuAnalysisData = z.infer<typeof MenuAnalysisDataSchema>;

// ---------------------------------------------------------------------------
// MenuAnalysisResponseSchema — API response envelope
// ---------------------------------------------------------------------------

export const MenuAnalysisResponseSchema = z.object({
  success: z.literal(true),
  data: MenuAnalysisDataSchema,
});

export type MenuAnalysisResponse = z.infer<typeof MenuAnalysisResponseSchema>;
