// API Key schemas — F026
//
// Used by the auth middleware in packages/api to validate API keys,
// and by any consumer that needs to work with the ApiKey data model.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// ApiKeyTierSchema
// ---------------------------------------------------------------------------

export const ApiKeyTierSchema = z.enum(['free', 'pro', 'admin']);
export type ApiKeyTier = z.infer<typeof ApiKeyTierSchema>;

// ---------------------------------------------------------------------------
// ApiKeySchema — full DB row shape (internal use)
// ---------------------------------------------------------------------------

export const ApiKeySchema = z.object({
  id:         z.string().uuid(),
  keyHash:    z.string().length(64),
  keyPrefix:  z.string().length(8),
  name:       z.string().min(1).max(255),
  tier:       ApiKeyTierSchema,
  isActive:   z.boolean(),
  expiresAt:  z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt:  z.string().datetime(),
  updatedAt:  z.string().datetime(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// ---------------------------------------------------------------------------
// ApiKeyContextSchema — attached to FastifyRequest after validation
// ---------------------------------------------------------------------------

export const ApiKeyContextSchema = z.object({
  keyId: z.string().uuid(),
  tier:  ApiKeyTierSchema,
});
export type ApiKeyContext = z.infer<typeof ApiKeyContextSchema>;

// ---------------------------------------------------------------------------
// ApiKeyValidationResultSchema — return type of the validation function
// ---------------------------------------------------------------------------

export const ApiKeyValidationResultSchema = z.object({
  valid:  z.boolean(),
  keyId:  z.string().uuid().optional(),
  tier:   ApiKeyTierSchema.optional(),
  reason: z.enum(['not_found', 'inactive', 'expired']).optional(),
});
export type ApiKeyValidationResult = z.infer<typeof ApiKeyValidationResultSchema>;
