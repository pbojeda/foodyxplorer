import { z } from 'zod';
import { ConfidenceLevelSchema, PortionContextSchema } from './enums';

export const StandardPortionSchema = z.object({
  id: z.string().uuid(),
  foodId: z.string().uuid().nullable(),
  foodGroup: z.string().max(100).nullable(),
  context: PortionContextSchema,
  portionGrams: z.number().positive(),
  sourceId: z.string().uuid(),
  notes: z.string().nullable().optional(),
  confidenceLevel: ConfidenceLevelSchema,
  description: z.string().min(1).max(255),
  isDefault: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type StandardPortion = z.infer<typeof StandardPortionSchema>;

export const CreateStandardPortionSchema = StandardPortionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  isDefault: z.boolean().default(false),
}).refine(
  (data) =>
    (data.foodId !== null && data.foodGroup === null) ||
    (data.foodId === null && data.foodGroup !== null),
  {
    message:
      'Exactly one of foodId or foodGroup must be set (XOR constraint)',
    path: ['foodId'],
  },
);
export type CreateStandardPortion = z.infer<typeof CreateStandardPortionSchema>;
