// routes/history.ts — Search history endpoints (F-WEB-HISTORY)
//
// GET    /history          — cursor-paginated history (bearer-gated, read-only)
// DELETE /history/:id      — delete single entry (bearer-gated, 404 on not-found/not-owned)
// DELETE /history          — clear all history for account (bearer-gated, idempotent)
//
// Auth pattern: manual verifyBearerJwt call (same as GET /me/usage in auth.ts).
// NOT in ROUTE_BUCKET_MAP — not quota-consuming (AC16).
// Identity: request.accountId = JWT sub = auth_user_id (NOT accounts.id).
//           accounts.id is resolved via resolveAccountIdFromSub().
//
// Cross-model constraints honored:
//   C1: GET /history is read-only — no account upsert on GET.
//   X3: resolveAccountIdFromSub throws on DB error (propagates to 500).
//   G-CRIT: (enforced in conversation.ts persistence hook, not here)

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { verifyBearerJwt } from '../plugins/authBearer.js';
import {
  resolveAccountIdFromSub,
  listHistory,
  deleteHistoryEntry,
  clearHistory,
  encodeCursor,
  decodeCursor,
} from '../lib/searchHistory.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface HistoryPluginOptions {
  prisma: PrismaClient;
  config: Config;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveJwksUrl(config: Config): string {
  if (config.SUPABASE_JWKS_URL) return config.SUPABASE_JWKS_URL;
  if (config.SUPABASE_URL) return `${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  throw Object.assign(new Error('SUPABASE_URL is not configured'), {
    code: 'AUTH_PROVIDER_UNAVAILABLE',
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const historyRoutesPlugin: FastifyPluginAsync<HistoryPluginOptions> = async (app, opts) => {
  const { prisma, config } = opts;

  // -------------------------------------------------------------------------
  // GET /history
  // Cursor-paginated search history for the authenticated account, newest-first.
  // -------------------------------------------------------------------------

  app.get(
    '/history',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Step 1: Bearer gate
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        throw Object.assign(new Error('Authorization Bearer token is required'), {
          code: 'UNAUTHORIZED',
        });
      }

      // Step 2: Verify JWT
      const jwksUrl = resolveJwksUrl(config);
      const payload = await verifyBearerJwt(authHeader, jwksUrl);
      const sub = payload.sub;

      // Step 3: Validate query params
      const query = request.query as Record<string, string | undefined>;
      const rawLimit = query['limit'];
      const rawCursor = query['cursor'];

      let limit = 10; // default
      if (rawLimit !== undefined) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
          throw Object.assign(new Error('limit must be an integer between 1 and 50'), {
            code: 'VALIDATION_ERROR',
          });
        }
        limit = parsed;
      }

      // Step 4: Decode cursor if present
      let cursor: string | null = null;
      if (rawCursor !== undefined && rawCursor !== '') {
        // decodeCursor throws INVALID_CURSOR on malformed input
        decodeCursor(rawCursor);
        cursor = rawCursor;
      }

      // Step 5: Resolve account (read-only — no upsert, cross-model C1)
      // resolveAccountIdFromSub THROWS on DB error (X3); returns null on no-row
      const accountId = await resolveAccountIdFromSub(prisma, sub, request.log);
      if (accountId === null) {
        // No accounts row yet — return empty (provisioning stays in /me)
        return reply.status(200).send({
          success: true,
          data: { entries: [], nextCursor: null },
        });
      }

      // Step 6: Fetch history
      const { rows, hasMore } = await listHistory(prisma, accountId, cursor, limit);

      // Step 7: Map rows to SearchHistoryEntry shape
      const entries = rows.map((row) => ({
        id: row['id'],
        kind: row['kind'],
        queryText: row['query_text'],
        resultData: row['result_jsonb'],
        createdAt: row['created_at'].toISOString(),
      }));

      // Step 8: Encode next cursor
      const lastRow = rows[rows.length - 1];
      const nextCursor = hasMore && lastRow ? encodeCursor(lastRow) : null;

      return reply.status(200).send({
        success: true,
        data: { entries, nextCursor },
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /history/:id
  // Deletes a single search_history row owned by the caller's account.
  // Returns 404 for both "not found" and "not owned" (no-enumeration).
  // -------------------------------------------------------------------------

  app.delete(
    '/history/:id',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Bearer gate
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        throw Object.assign(new Error('Authorization Bearer token is required'), {
          code: 'UNAUTHORIZED',
        });
      }

      const jwksUrl = resolveJwksUrl(config);
      const payload = await verifyBearerJwt(authHeader, jwksUrl);
      const sub = payload.sub;

      // Validate :id param
      const params = request.params as { id: string };
      if (!UUID_RE.test(params['id'] ?? '')) {
        throw Object.assign(new Error('id must be a valid UUID'), {
          code: 'VALIDATION_ERROR',
        });
      }

      const entryId = params['id'];

      // Resolve account (throws on DB error — X3)
      const accountId = await resolveAccountIdFromSub(prisma, sub, request.log);
      if (accountId === null) {
        // No account → no entries → 404
        throw Object.assign(new Error('History entry not found'), { code: 'NOT_FOUND' });
      }

      // Delete (returns false if 0 rows)
      const deleted = await deleteHistoryEntry(prisma, accountId, entryId);
      if (!deleted) {
        throw Object.assign(new Error('History entry not found'), { code: 'NOT_FOUND' });
      }

      return reply.status(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /history
  // Clears all history for the authenticated account. Idempotent.
  // -------------------------------------------------------------------------

  app.delete(
    '/history',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Bearer gate
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        throw Object.assign(new Error('Authorization Bearer token is required'), {
          code: 'UNAUTHORIZED',
        });
      }

      const jwksUrl = resolveJwksUrl(config);
      const payload = await verifyBearerJwt(authHeader, jwksUrl);
      const sub = payload.sub;

      // Resolve account (throws on DB error — X3)
      const accountId = await resolveAccountIdFromSub(prisma, sub, request.log);
      if (accountId === null) {
        // No account → no entries → idempotent 204
        return reply.status(204).send();
      }

      await clearHistory(prisma, accountId);
      return reply.status(204).send();
    },
  );
};

// Wrap with fastifyPlugin so errors route to the global error handler
export const historyRoutes = fastifyPlugin(historyRoutesPlugin, {
  name: 'historyRoutes',
  dependencies: [],
});
