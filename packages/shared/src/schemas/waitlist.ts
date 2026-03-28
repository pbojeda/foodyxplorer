// Waitlist schemas — F046 Waitlist Persistence + Anti-Spam
//
// Three schemas:
//   WaitlistSubmissionSchema        — full record shape (from DB)
//   CreateWaitlistSubmissionSchema  — POST /waitlist body
//   AdminWaitlistQuerySchema        — GET /admin/waitlist query params

import { z } from 'zod';

// ---------------------------------------------------------------------------
// CreateWaitlistSubmissionSchema — POST /waitlist body
// ---------------------------------------------------------------------------

export const CreateWaitlistSubmissionSchema = z.object({
  email: z.string().email(),
  // phone: trim whitespace, coerce empty/whitespace-only to null
  phone: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return null;
      const trimmed = v.trim();
      return trimmed === '' ? null : trimmed;
    })
    .nullable(),
  variant: z.enum(['a', 'c', 'f']),
  source: z.enum(['hero', 'cta', 'footer', 'post-simulator']),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  // honeypot: any string or undefined — route handler does business logic rejection
  honeypot: z.string().optional(),
});

export type CreateWaitlistSubmission = z.infer<typeof CreateWaitlistSubmissionSchema>;

// ---------------------------------------------------------------------------
// AdminWaitlistQuerySchema — GET /admin/waitlist query params
// ---------------------------------------------------------------------------

export const AdminWaitlistQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['created_at_desc', 'created_at_asc']).default('created_at_desc'),
});

export type AdminWaitlistQuery = z.infer<typeof AdminWaitlistQuerySchema>;

// ---------------------------------------------------------------------------
// WaitlistSubmissionSchema — full record shape
// ---------------------------------------------------------------------------

export const WaitlistSubmissionSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  phone: z.string().nullable(),
  variant: z.string(),
  source: z.string(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.date(),
});

export type WaitlistSubmission = z.infer<typeof WaitlistSubmissionSchema>;
