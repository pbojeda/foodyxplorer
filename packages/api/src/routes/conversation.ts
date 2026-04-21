// Conversation routes plugin (F070 + F075)
//
// POST /conversation/message — Validates body with ConversationMessageBodySchema,
//   delegates to processMessage(), wraps in { success: true, data } envelope.
//   Fire-and-forget writeQueryLog on reply.raw 'finish' event.
//   Rate limit: shares 'queries' bucket with GET /estimate (50/day per actor).
//
// POST /conversation/audio — Accepts multipart/form-data with an audio file.
//   Transcribes via OpenAI Whisper, then delegates to processMessage().
//   Same response shape and rate limit bucket as /conversation/message.

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { MultipartFile as MultipartFilePart, MultipartValue } from '@fastify/multipart';
import { ConversationMessageBodySchema } from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import { level4Lookup } from '../estimation/level4Lookup.js';
import { loadChainData } from '../conversation/chainResolver.js';
import { processMessage } from '../conversation/conversationCore.js';
import { config } from '../config.js';
import { writeQueryLog } from '../lib/queryLogger.js';
import type { ChainRow } from '../conversation/types.js';
import { callWhisperTranscription, isWhisperHallucination } from '../lib/openaiClient.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface ConversationPluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
  redis: Redis;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const conversationRoutesPlugin: FastifyPluginAsync<ConversationPluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma, redis } = opts;

  // Load chain data once at plugin init for context resolution
  let chains: ChainRow[] = [];
  let chainSlugs: string[] = [];
  try {
    chains = await loadChainData(db);
    chainSlugs = chains.map((c) => c.chainSlug);
  } catch (err) {
    app.log.warn({ err }, 'F070: Failed to load chain data, context-set and brand detection disabled');
  }

  app.post(
    '/conversation/message',
    {
      schema: {
        body: ConversationMessageBodySchema,
        tags: ['Conversation'],
        operationId: 'conversationMessage',
        summary: 'Process a natural language message',
        description:
          'Processes a plain-text natural language query. Returns a structured ConversationMessageData ' +
          'with intent, estimation/comparison/contextSet data. Rate-limited to 50/day per actor (shared with GET /estimate).',
      },
    },
    async (request, reply) => {
      const startMs = performance.now();

      const body = request.body as {
        text: string;
        chainSlug?: string;
        chainName?: string;
      };

      const actorId = request.actorId;
      if (!actorId) {
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Actor resolution failed' },
        });
      }
      // Capture as string | null for query log entries (actorId is `string` after guard above,
      // but TypeScript does not narrow closure variables — explicit cast avoids type error).
      const actorIdForLog: string | null = actorId;

      // Parse X-FXP-Source header
      const rawSource = request.headers['x-fxp-source'];
      const firstVal = Array.isArray(rawSource)
        ? rawSource[0]
        : typeof rawSource === 'string'
        ? rawSource.split(',')[0]?.trim()
        : undefined;
      const source = firstVal === 'bot' ? 'bot' as const : 'api' as const;

      // capturedData is set after processMessage resolves and read by logQueryAfterReply.
      let capturedData: import('@foodxplorer/shared').ConversationMessageData | null = null;

      // Fire-and-forget query log — registered before processMessage so the 'finish'
      // listener is always in place, even if processMessage throws (no-op when capturedData is null).
      reply.raw.once('finish', () => {
        const responseTimeMs = Math.round(performance.now() - startMs);
        void logQueryAfterReply(responseTimeMs).catch(() => {});
      });

      // Run the conversation pipeline
      const data = await processMessage({
        text: body.text,
        actorId,
        db,
        redis,
        prisma,
        openAiApiKey: config.OPENAI_API_KEY,
        level4Lookup,
        chainSlugs,
        chains,
        logger: request.log,
        legacyChainSlug: body.chainSlug,
        legacyChainName: body.chainName,
      });

      // Capture result data for query log (must be before reply.send)
      capturedData = data;

      return reply.send({ success: true, data });

      // -----------------------------------------------------------------------
      // Query logging helper (fire-and-forget, called from 'finish' listener)
      // -----------------------------------------------------------------------

      async function logQueryAfterReply(responseTimeMs: number): Promise<void> {
        if (!capturedData) return;

        const intent = capturedData.intent;
        const apiKeyId = request.apiKeyContext?.keyId ?? null;

        if (intent === 'estimation' && capturedData.estimation) {
          const est = capturedData.estimation;
          let levelHit: 'l1' | 'l2' | 'l3' | 'l4' | null = null;
          if (est.level1Hit) levelHit = 'l1';
          else if (est.level2Hit) levelHit = 'l2';
          else if (est.level3Hit) levelHit = 'l3';
          else if (est.level4Hit) levelHit = 'l4';

          await writeQueryLog(
            prisma,
            {
              queryText: est.query,
              chainSlug: est.chainSlug ?? null,
              restaurantId: null,
              levelHit,
              cacheHit: est.cachedAt !== null,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'comparison' && capturedData.comparison) {
          const { dishA, dishB } = capturedData.comparison;

          const getLevelHit = (est: typeof dishA): 'l1' | 'l2' | 'l3' | 'l4' | null => {
            if (est.level1Hit) return 'l1';
            if (est.level2Hit) return 'l2';
            if (est.level3Hit) return 'l3';
            if (est.level4Hit) return 'l4';
            return null;
          };

          await writeQueryLog(
            prisma,
            {
              queryText: dishA.query,
              chainSlug: dishA.chainSlug ?? null,
              restaurantId: null,
              levelHit: getLevelHit(dishA),
              cacheHit: false, // comparisons don't get cache hits (parallel queries)
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );

          await writeQueryLog(
            prisma,
            {
              queryText: dishB.query,
              chainSlug: dishB.chainSlug ?? null,
              restaurantId: null,
              levelHit: getLevelHit(dishB),
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'menu_estimation' && capturedData.menuEstimation) {
          const menuItems = capturedData.menuEstimation.items;
          const queryText = 'menú: ' + menuItems.map((i) => i.query).join(', ');
          await writeQueryLog(
            prisma,
            {
              queryText: queryText.slice(0, 500),
              chainSlug: capturedData.activeContext?.chainSlug ?? null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'context_set') {
          await writeQueryLog(
            prisma,
            {
              queryText: body.text,
              chainSlug: null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'text_too_long') {
          await writeQueryLog(
            prisma,
            {
              queryText: body.text.slice(0, 500),
              chainSlug: null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        }
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /conversation/audio — Multipart audio upload → Whisper → processMessage
  // -------------------------------------------------------------------------

  // audio/wav omitted: browsers never produce WAV and we have no RIFF duration parser (F091)
  const ALLOWED_AUDIO_MIME_TYPES = new Set([
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
  ]);

  app.post(
    '/conversation/audio',
    {
      schema: {
        tags: ['Conversation'],
        operationId: 'conversationAudio',
        summary: 'Process a voice message via Whisper transcription',
        description:
          'Accepts a multipart audio file. Transcribes via OpenAI Whisper, then delegates to the ' +
          'Conversation Core pipeline. Returns the same ConversationMessageData envelope as ' +
          'POST /conversation/message. Rate-limited to 50/day per actor (shared with GET /estimate).',
      },
    },
    async (request, reply) => {
      const startMs = performance.now();

      // Step 1: Parse multipart stream — collect audio file part and text fields
      let audioBuffer: Buffer | undefined;
      let audioMimeType: string | undefined;
      let durationRaw: string | undefined;
      let chainSlug: string | undefined;
      let chainName: string | undefined;

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const filePart = part as MultipartFilePart;
          if (audioBuffer === undefined) {
            audioMimeType = filePart.mimetype;
            audioBuffer = await filePart.toBuffer();
          } else {
            await filePart.toBuffer();
          }
        } else {
          const fieldPart = part as MultipartValue<string>;
          if (typeof fieldPart.value === 'string') {
            if (fieldPart.fieldname === 'duration') durationRaw = fieldPart.value;
            else if (fieldPart.fieldname === 'chainSlug') chainSlug = fieldPart.value;
            else if (fieldPart.fieldname === 'chainName') chainName = fieldPart.value;
          }
        }
      }

      // Step 2: Guard — missing audio part
      if (audioBuffer === undefined || audioMimeType === undefined) {
        throw Object.assign(
          new Error('Missing audio file part in multipart request'),
          { code: 'VALIDATION_ERROR' },
        );
      }

      // Step 3: Guard — unsupported MIME type
      if (!ALLOWED_AUDIO_MIME_TYPES.has(audioMimeType)) {
        throw Object.assign(
          new Error(`Unsupported audio MIME type: ${audioMimeType}. Allowed: audio/ogg, audio/mpeg, audio/mp4, audio/webm`),
          { code: 'VALIDATION_ERROR' },
        );
      }

      // Step 4: Guard — missing or non-numeric duration
      if (durationRaw === undefined || durationRaw.trim() === '') {
        throw Object.assign(
          new Error('Missing required field: duration'),
          { code: 'VALIDATION_ERROR' },
        );
      }
      const duration = Number(durationRaw);
      if (!Number.isFinite(duration)) {
        throw Object.assign(
          new Error('Invalid duration: must be a number'),
          { code: 'VALIDATION_ERROR' },
        );
      }

      // Step 5: Guard — duration must be 0-120s
      if (duration < 0 || duration > 120) {
        throw Object.assign(
          new Error('Audio duration must be between 0 and 120 seconds'),
          { code: 'VALIDATION_ERROR' },
        );
      }

      const actorId = request.actorId;
      if (!actorId) {
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Actor resolution failed' },
        });
      }
      const actorIdForLog: string | null = actorId;

      // Parse X-FXP-Source header
      const rawSource = request.headers['x-fxp-source'];
      const firstVal = Array.isArray(rawSource)
        ? rawSource[0]
        : typeof rawSource === 'string'
        ? rawSource.split(',')[0]?.trim()
        : undefined;
      const source = firstVal === 'bot' ? 'bot' as const : 'api' as const;

      // capturedData is set after processMessage resolves — no-op if Whisper fails
      let capturedData: import('@foodxplorer/shared').ConversationMessageData | null = null;
      let transcribedText: string | null = null;

      // Fire-and-forget query log — registered before Whisper so the 'finish' listener
      // is always in place (no-op when capturedData is null on early 422 returns)
      reply.raw.once('finish', () => {
        const responseTimeMs = Math.round(performance.now() - startMs);
        void logAudioQueryAfterReply(responseTimeMs).catch(() => {});
      });

      // Step 6: Transcribe via Whisper
      const transcription = await callWhisperTranscription(
        config.OPENAI_API_KEY,
        audioBuffer,
        audioMimeType,
        request.log,
      );

      // Step 7: Guard — Whisper API failure
      if (transcription === null) {
        throw Object.assign(
          new Error('Audio transcription failed'),
          { code: 'TRANSCRIPTION_FAILED' },
        );
      }

      // Step 8: Guard — empty transcription
      if (transcription.trim() === '') {
        throw Object.assign(
          new Error('Audio transcription returned empty text'),
          { code: 'EMPTY_TRANSCRIPTION' },
        );
      }

      // Step 9: Guard — hallucination filter
      if (isWhisperHallucination(transcription)) {
        throw Object.assign(
          new Error('Audio transcription appears to be a hallucination'),
          { code: 'EMPTY_TRANSCRIPTION' },
        );
      }

      transcribedText = transcription;

      // Step 10: Run the conversation pipeline with transcribed text
      const data = await processMessage({
        text: transcribedText,
        actorId,
        db,
        redis,
        prisma,
        openAiApiKey: config.OPENAI_API_KEY,
        level4Lookup,
        chainSlugs,
        chains,
        logger: request.log,
        legacyChainSlug: chainSlug,
        legacyChainName: chainName,
      });

      capturedData = data;

      return reply.send({ success: true, data });

      // -----------------------------------------------------------------------
      // Query logging helper (fire-and-forget, called from 'finish' listener)
      // -----------------------------------------------------------------------

      async function logAudioQueryAfterReply(responseTimeMs: number): Promise<void> {
        if (!capturedData || !transcribedText) return;

        const intent = capturedData.intent;
        const apiKeyId = request.apiKeyContext?.keyId ?? null;

        if (intent === 'estimation' && capturedData.estimation) {
          const est = capturedData.estimation;
          let levelHit: 'l1' | 'l2' | 'l3' | 'l4' | null = null;
          if (est.level1Hit) levelHit = 'l1';
          else if (est.level2Hit) levelHit = 'l2';
          else if (est.level3Hit) levelHit = 'l3';
          else if (est.level4Hit) levelHit = 'l4';

          await writeQueryLog(
            prisma,
            {
              queryText: est.query,
              chainSlug: est.chainSlug ?? null,
              restaurantId: null,
              levelHit,
              cacheHit: est.cachedAt !== null,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'comparison' && capturedData.comparison) {
          const { dishA, dishB } = capturedData.comparison;

          const getLevelHit = (est: typeof dishA): 'l1' | 'l2' | 'l3' | 'l4' | null => {
            if (est.level1Hit) return 'l1';
            if (est.level2Hit) return 'l2';
            if (est.level3Hit) return 'l3';
            if (est.level4Hit) return 'l4';
            return null;
          };

          await writeQueryLog(
            prisma,
            {
              queryText: dishA.query,
              chainSlug: dishA.chainSlug ?? null,
              restaurantId: null,
              levelHit: getLevelHit(dishA),
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );

          await writeQueryLog(
            prisma,
            {
              queryText: dishB.query,
              chainSlug: dishB.chainSlug ?? null,
              restaurantId: null,
              levelHit: getLevelHit(dishB),
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'menu_estimation' && capturedData.menuEstimation) {
          const menuItems = capturedData.menuEstimation.items;
          const queryText = 'menú: ' + menuItems.map((i) => i.query).join(', ');
          await writeQueryLog(
            prisma,
            {
              queryText: queryText.slice(0, 500),
              chainSlug: capturedData.activeContext?.chainSlug ?? null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'context_set') {
          await writeQueryLog(
            prisma,
            {
              queryText: transcribedText,
              chainSlug: null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'text_too_long') {
          await writeQueryLog(
            prisma,
            {
              queryText: transcribedText.slice(0, 500),
              chainSlug: null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        }
      }
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to conversation route errors.
export const conversationRoutes = fastifyPlugin(conversationRoutesPlugin);
