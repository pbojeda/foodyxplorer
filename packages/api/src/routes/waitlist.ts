// Waitlist routes — F046 Waitlist Persistence + Anti-Spam
//
// POST /waitlist   — public endpoint to add a lead. Per-route rate limit.
// GET  /admin/waitlist — admin-authenticated paginated list.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  CreateWaitlistSubmissionSchema,
  AdminWaitlistQuerySchema,
} from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface WaitlistPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const waitlistRoutesPlugin: FastifyPluginAsync<WaitlistPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  // -------------------------------------------------------------------------
  // POST /waitlist — public endpoint with per-route rate limit
  // -------------------------------------------------------------------------

  app.post(
    '/waitlist',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req: FastifyRequest) => `ip:${req.ip ?? 'unknown'}`,
        },
      },
      schema: {
        body: CreateWaitlistSubmissionSchema,
        tags: ['Waitlist'],
        summary: 'Register a waitlist lead',
        description:
          'Persists a waitlist submission. Idempotent on duplicate email (returns 409). Anti-spam honeypot field included.',
      },
    },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        phone: string | null;
        variant: string;
        source: string;
        utm_source?: string;
        utm_medium?: string;
        utm_campaign?: string;
        honeypot?: string;
      };

      // Honeypot check — silently reject with generic 400 (do not reveal mechanism)
      if (body.honeypot !== undefined && body.honeypot !== '') {
        throw Object.assign(new Error('Invalid data'), { code: 'VALIDATION_ERROR' });
      }

      const ipAddress = request.ip ?? null;

      try {
        const submission = await prisma.waitlistSubmission.create({
          data: {
            email: body.email,
            phone: body.phone ?? null,
            variant: body.variant,
            source: body.source,
            utmSource: body.utm_source ?? null,
            utmMedium: body.utm_medium ?? null,
            utmCampaign: body.utm_campaign ?? null,
            ipAddress,
          },
        });

        // Progressive enhancement: if request is a form POST (non-JS),
        // redirect via 303 to avoid duplicate submission on browser back.
        const contentType = request.headers['content-type'] ?? '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
          return reply.redirect(`/?waitlist=success`, 303);
        }

        return reply.status(201).send({
          success: true,
          data: { id: submission.id, email: submission.email },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw Object.assign(
            new Error('Email already registered'),
            { code: 'DUPLICATE_EMAIL' },
          );
        }
        throw err;
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /admin/waitlist — admin-authenticated paginated list
  // Admin auth is handled globally by isAdminRoute() — no preHandler needed.
  // -------------------------------------------------------------------------

  app.get(
    '/admin/waitlist',
    {
      schema: {
        querystring: AdminWaitlistQuerySchema,
        tags: ['Admin', 'Waitlist'],
        summary: 'List waitlist submissions (admin)',
        description:
          'Paginated list of all waitlist submissions. Requires ADMIN_API_KEY header.',
      },
    },
    async (request, reply) => {
      const query = request.query as {
        limit: number;
        offset: number;
        sort: 'created_at_desc' | 'created_at_asc';
      };

      const orderBy =
        query.sort === 'created_at_asc'
          ? { createdAt: 'asc' as const }
          : { createdAt: 'desc' as const };

      const [submissions, total] = await Promise.all([
        prisma.waitlistSubmission.findMany({
          orderBy,
          take: query.limit,
          skip: query.offset,
        }),
        prisma.waitlistSubmission.count(),
      ]);

      return reply.send({
        success: true,
        data: {
          submissions: submissions.map((s) => ({
            id: s.id,
            email: s.email,
            phone: s.phone,
            variant: s.variant,
            source: s.source,
            utm_source: s.utmSource,
            utm_medium: s.utmMedium,
            utm_campaign: s.utmCampaign,
            ip_address: s.ipAddress,
            created_at: s.createdAt,
          })),
          total,
          limit: query.limit,
          offset: query.offset,
        },
      });
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to waitlist route errors.
export const waitlistRoutes = fastifyPlugin(waitlistRoutesPlugin);
