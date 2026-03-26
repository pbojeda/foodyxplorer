// POST /ingest/image — Multipart image nutritional data ingestion route.
//
// Accepts a multipart JPEG or PNG upload, runs Tesseract.js OCR to extract
// text, parses nutritional tables, normalizes through the scraper pipeline,
// and persists via Prisma upsert.
//
// Unlike POST /ingest/image-url, this route accepts a file buffer directly
// (no URL download). There is no sourceUrl in the response.
//
// Plugin options: { prisma: PrismaClient }
//
// Error codes: VALIDATION_ERROR (400), NOT_FOUND (404), PROCESSING_TIMEOUT (408),
//              PAYLOAD_TOO_LARGE (413), INVALID_IMAGE (422), OCR_FAILED (422),
//              NO_NUTRITIONAL_DATA_FOUND (422), DB_UNAVAILABLE (500)

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { type PrismaClient, Prisma } from '@prisma/client';
import type { MultipartValue, MultipartFile as MultipartFilePart } from '@fastify/multipart';
import {
  normalizeNutrients,
  normalizeDish,
  NormalizedDishDataSchema,
} from '@foodxplorer/scraper';

import { extractTextFromImage } from '../../lib/imageOcrExtractor.js';
import { parseNutritionTable } from '../../ingest/nutritionTableParser.js';
import { preprocessChainText } from '../../ingest/chainTextPreprocessor.js';
import { getChainSourceLocale } from '../../ingest/chainLocaleRegistry.js';

// ---------------------------------------------------------------------------
// Zod schemas (API-internal)
// ---------------------------------------------------------------------------

const IngestImageBodySchema = z.object({
  restaurantId: z.string().uuid(),
  sourceId:     z.string().uuid(),
  dryRun:       z.string().transform((v) => v === 'true').default('false'),
  chainSlug:    z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
});

interface IngestImageSkippedReason {
  dishName: string;
  reason:   string;
}

// ---------------------------------------------------------------------------
// Domain error codes — used in the Prisma catch block to re-throw
// ---------------------------------------------------------------------------

const DOMAIN_CODES = new Set([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INVALID_IMAGE',
  'OCR_FAILED',
  'NO_NUTRITIONAL_DATA_FOUND',
  'PROCESSING_TIMEOUT',
  'PAYLOAD_TOO_LARGE',
  'DB_UNAVAILABLE',
]);

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface IngestImagePluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const ingestImageRoutesPlugin: FastifyPluginAsync<IngestImagePluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  app.post('/ingest/image', async (request, reply) => {
    // -------------------------------------------------------------------------
    // Step 1: Parse multipart stream
    // -------------------------------------------------------------------------
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | undefined;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (fileBuffer === undefined) {
          // Only process the first file part
          const filePart = part as MultipartFilePart;
          fileBuffer = await filePart.toBuffer();
        } else {
          // Drain subsequent file parts to avoid memory leaks
          await (part as MultipartFilePart).toBuffer();
        }
      } else {
        // Text field
        const fieldPart = part as MultipartValue<string>;
        const fieldName = fieldPart.fieldname;
        const fieldValue = fieldPart.value;
        if (typeof fieldValue === 'string') {
          fields[fieldName] = fieldValue;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Step 2: Guard — file part must be present (before Zod validation)
    // -------------------------------------------------------------------------
    if (fileBuffer === undefined) {
      throw Object.assign(
        new Error('Missing file part in multipart request'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    // -------------------------------------------------------------------------
    // Step 3: Validate non-file fields via Zod
    // -------------------------------------------------------------------------
    const parseResult = IngestImageBodySchema.safeParse(fields);
    if (!parseResult.success) {
      throw parseResult.error; // ZodError — error handler maps to 400 VALIDATION_ERROR
    }

    const { restaurantId, sourceId, dryRun, chainSlug } = parseResult.data;

    // -------------------------------------------------------------------------
    // Step 4: Validate magic bytes — JPEG (FFD8FF) or PNG (89504E47)
    // -------------------------------------------------------------------------
    const isJpeg = fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff;
    const isPng  = fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4e && fileBuffer[3] === 0x47;

    if (!isJpeg && !isPng) {
      throw Object.assign(
        new Error('Uploaded file is not a valid image (not JPEG or PNG)'),
        { statusCode: 422, code: 'INVALID_IMAGE' },
      );
    }

    // -------------------------------------------------------------------------
    // Step 5: DB existence checks (run regardless of dryRun)
    // -------------------------------------------------------------------------
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { id: true },
    });
    if (restaurant === null) {
      throw Object.assign(
        new Error('Restaurant not found'),
        { statusCode: 404, code: 'NOT_FOUND' },
      );
    }

    const dataSource = await prisma.dataSource.findUnique({
      where:  { id: sourceId },
      select: { id: true },
    });
    if (dataSource === null) {
      throw Object.assign(
        new Error('Data source not found'),
        { statusCode: 404, code: 'NOT_FOUND' },
      );
    }

    // -------------------------------------------------------------------------
    // Step 6: Synthetic URL for internal tracking (NOT returned in response)
    // -------------------------------------------------------------------------
    const syntheticUrl = `upload://image-${Date.now()}`;

    // -------------------------------------------------------------------------
    // Steps 7–11: Processing pipeline wrapped in 60-second timeout
    // -------------------------------------------------------------------------
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          Object.assign(new Error('Processing timeout'), {
            statusCode: 408,
            code:       'PROCESSING_TIMEOUT',
          }),
        );
      }, 60_000);
    });

    const processingPromise = async (): Promise<{
      dishesFound:    number;
      dishesUpserted: number;
      dishesSkipped:  number;
      dryRun:         boolean;
      dishes:         z.infer<typeof NormalizedDishDataSchema>[];
      skippedReasons: IngestImageSkippedReason[];
    }> => {
      const scrapedAt = new Date().toISOString();

      // -----------------------------------------------------------------------
      // Step 7: OCR — extract text lines from image
      // -----------------------------------------------------------------------
      let lines = await extractTextFromImage(fileBuffer as Buffer); // throws OCR_FAILED (422)

      // -----------------------------------------------------------------------
      // Step 8: Chain-specific text preprocessing
      // -----------------------------------------------------------------------
      if (chainSlug !== undefined) {
        lines = preprocessChainText(chainSlug, lines);
      }

      // -----------------------------------------------------------------------
      // Step 9: Parse nutrition table
      // -----------------------------------------------------------------------
      const rawDishes = parseNutritionTable(lines, syntheticUrl, scrapedAt);

      if (rawDishes.length === 0) {
        throw Object.assign(
          new Error('No nutritional data found in image'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 10: Normalize dishes
      // -----------------------------------------------------------------------
      const validDishes: z.infer<typeof NormalizedDishDataSchema>[] = [];
      const skippedReasons: IngestImageSkippedReason[] = [];

      // Determine chain source locale once, outside the loop (F038)
      const chainSourceLocale = getChainSourceLocale(chainSlug);
      // nameSourceLocale to write: 'en' or 'es' for known chains, null for unknown
      const nameSourceLocale: string | null =
        chainSourceLocale === 'unknown' ? null : chainSourceLocale;

      for (const raw of rawDishes) {
        // F038: Populate nameEs based on chain source locale before normalizeDish()
        if (chainSourceLocale === 'es') {
          raw.nameEs = raw.name;
        } else if (chainSourceLocale === 'en') {
          // Leave nameEs undefined — run translate-dish-names script to backfill
          request.log.warn(
            { dishName: raw.name },
            '[ingest] nameEs not set — run translate-dish-names script',
          );
        }
        // else 'unknown': leave nameEs undefined, no warning

        // Normalize nutrients — returns null if required fields missing or calorie > 9000
        const normalizedNutrients = normalizeNutrients(raw.nutrients);
        if (normalizedNutrients === null) {
          skippedReasons.push({
            dishName: raw.name,
            reason:   'Missing required nutrient fields or calorie limit exceeded',
          });
          continue;
        }

        // Normalize dish metadata
        const dishMeta = normalizeDish(raw, { sourceId, restaurantId });

        // Merge and validate through NormalizedDishDataSchema
        const merged       = { ...dishMeta, nutrients: normalizedNutrients };
        const schemaResult = NormalizedDishDataSchema.safeParse(merged);
        if (!schemaResult.success) {
          const firstIssue = schemaResult.error.issues[0];
          skippedReasons.push({
            dishName: raw.name,
            reason:   firstIssue?.message ?? 'Validation failed',
          });
          continue;
        }

        validDishes.push(schemaResult.data);
      }

      if (validDishes.length === 0) {
        throw Object.assign(
          new Error('No nutritional data found in image'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 11: Persist (only if dryRun === false)
      // -----------------------------------------------------------------------
      let dishesUpserted = 0;

      if (!dryRun) {
        try {
          await prisma.$transaction(async (tx) => {
            for (const dish of validDishes) {
              // findFirst + create/update (no @@unique([restaurantId, name]) in Prisma schema)
              const existing = await tx.dish.findFirst({
                where:  { restaurantId: dish.restaurantId, name: dish.name },
                select: { id: true },
              });

              let dishId: string;

              if (existing === null) {
                const created = await tx.dish.create({
                  data: {
                    restaurantId:     dish.restaurantId,
                    sourceId:         dish.sourceId,
                    name:             dish.name,
                    nameEs:           dish.nameEs,
                    nameSourceLocale,
                    description:      dish.description,
                    externalId:       dish.externalId,
                    availability:     dish.availability,
                    portionGrams:     dish.portionGrams,
                    priceEur:         dish.priceEur,
                    confidenceLevel:  dish.confidenceLevel,
                    estimationMethod: dish.estimationMethod,
                    aliases:          dish.aliases,
                  },
                  select: { id: true },
                });
                dishId = created.id;
              } else {
                await tx.dish.update({
                  where: { id: existing.id },
                  data:  {
                    sourceId:         dish.sourceId,
                    nameEs:           dish.nameEs,
                    nameSourceLocale,
                    description:      dish.description,
                    availability:     dish.availability,
                    portionGrams:     dish.portionGrams,
                    priceEur:         dish.priceEur,
                    confidenceLevel:  dish.confidenceLevel,
                    estimationMethod: dish.estimationMethod,
                    aliases:          dish.aliases,
                  },
                });
                dishId = existing.id;
              }

              // Upsert dish nutrients
              const existingNutrient = await tx.dishNutrient.findFirst({
                where:  { dishId, sourceId: dish.sourceId },
                select: { id: true },
              });

              const nutrientData = {
                dishId,
                sourceId:             dish.sourceId,
                confidenceLevel:      dish.confidenceLevel,
                estimationMethod:     dish.estimationMethod,
                calories:             dish.nutrients.calories,
                proteins:             dish.nutrients.proteins,
                carbohydrates:        dish.nutrients.carbohydrates,
                sugars:               dish.nutrients.sugars,
                fats:                 dish.nutrients.fats,
                saturatedFats:        dish.nutrients.saturatedFats,
                fiber:                dish.nutrients.fiber,
                salt:                 dish.nutrients.salt,
                sodium:               dish.nutrients.sodium,
                transFats:            dish.nutrients.transFats,
                cholesterol:          dish.nutrients.cholesterol,
                potassium:            dish.nutrients.potassium,
                monounsaturatedFats:  dish.nutrients.monounsaturatedFats,
                polyunsaturatedFats:  dish.nutrients.polyunsaturatedFats,
                referenceBasis:       dish.nutrients.referenceBasis,
                extra: dish.nutrients.extra !== undefined
                  ? (dish.nutrients.extra as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
              };

              if (existingNutrient === null) {
                await tx.dishNutrient.create({ data: nutrientData });
              } else {
                await tx.dishNutrient.update({
                  where: { id: existingNutrient.id },
                  data:  nutrientData,
                });
              }

              dishesUpserted++;
            }
          }, { maxWait: 30_000, timeout: 120_000 });
        } catch (err) {
          // Re-throw domain errors — let the global error handler deal with them
          const asAny = err as Record<string, unknown>;
          if (typeof asAny['code'] === 'string' && DOMAIN_CODES.has(asAny['code'])) {
            throw err;
          }
          throw Object.assign(
            new Error('Database write failed'),
            { statusCode: 500, code: 'DB_UNAVAILABLE' },
          );
        }
      }

      // Note: syntheticUrl is NOT included in the response (key difference from image-url.ts)
      return {
        dishesFound:    rawDishes.length,
        dishesUpserted,
        dishesSkipped:  skippedReasons.length,
        dryRun,
        dishes:         validDishes,
        skippedReasons,
      };
    };

    try {
      const result = await Promise.race([processingPromise(), timeoutPromise]);

      return reply.status(200).send({
        success: true,
        data:    result,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  });
};

export const ingestImageRoutes = fastifyPlugin(ingestImageRoutesPlugin);
