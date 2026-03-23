// POST /ingest/image-url — Image URL nutritional data ingestion route.
//
// Accepts a JSON body with a URL pointing to an image file, downloads it using
// imageDownloader (Node.js built-in fetch, 30-second timeout, 10 MB size cap),
// validates magic bytes (JPEG: FFD8FF, PNG: 89504E47), runs Tesseract.js OCR to
// extract text, parses nutritional tables, normalizes and persists via Prisma upsert.
//
// Plugin options: { prisma: PrismaClient }
//
// Error codes: VALIDATION_ERROR (400), NOT_FOUND (404), PROCESSING_TIMEOUT (408),
//              PAYLOAD_TOO_LARGE (413), INVALID_URL (422), FETCH_FAILED (422),
//              INVALID_IMAGE (422), OCR_FAILED (422),
//              NO_NUTRITIONAL_DATA_FOUND (422), DB_UNAVAILABLE (500)

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { type PrismaClient, Prisma } from '@prisma/client';
import {
  normalizeNutrients,
  normalizeDish,
  NormalizedDishDataSchema,
} from '@foodxplorer/scraper';

import { assertNotSsrf } from '../../lib/ssrfGuard.js';
import { downloadImage } from '../../lib/imageDownloader.js';
import { extractTextFromImage } from '../../lib/imageOcrExtractor.js';
import { parseNutritionTable } from '../../ingest/nutritionTableParser.js';
import { preprocessChainText } from '../../ingest/chainTextPreprocessor.js';

// ---------------------------------------------------------------------------
// Zod schemas (API-internal)
// ---------------------------------------------------------------------------

const IngestImageUrlBodySchema = z.object({
  url:          z.string().url().max(2048),
  restaurantId: z.string().uuid(),
  sourceId:     z.string().uuid(),
  dryRun:       z.boolean().default(false),
  chainSlug:    z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
});

interface IngestImageUrlSkippedReason {
  dishName: string;
  reason:   string;
}

// ---------------------------------------------------------------------------
// Domain error codes — used in the Prisma catch block to re-throw
// ---------------------------------------------------------------------------

const DOMAIN_CODES = new Set([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INVALID_URL',
  'FETCH_FAILED',
  'INVALID_IMAGE',
  'OCR_FAILED',
  'NO_NUTRITIONAL_DATA_FOUND',
  'PROCESSING_TIMEOUT',
  'PAYLOAD_TOO_LARGE',
]);

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface IngestImageUrlPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const ingestImageUrlRoutesPlugin: FastifyPluginAsync<IngestImageUrlPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  app.post('/ingest/image-url', async (request, reply) => {
    // -------------------------------------------------------------------------
    // Step 1: Parse JSON body
    // -------------------------------------------------------------------------
    const parseResult = IngestImageUrlBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw parseResult.error; // ZodError — error handler maps to 400 VALIDATION_ERROR
    }

    const { url, restaurantId, sourceId, dryRun, chainSlug } = parseResult.data;

    // -------------------------------------------------------------------------
    // Step 2: URL sanity check — scheme + SSRF guard
    // -------------------------------------------------------------------------
    assertNotSsrf(url); // throws INVALID_URL (422) if blocked

    // -------------------------------------------------------------------------
    // Step 3: DB existence checks (run regardless of dryRun)
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
    // Steps 4–8: Processing pipeline wrapped in 60-second timeout
    //
    // NOTE: downloadImage() has its own 30s AbortSignal.timeout for hung
    // connections. This route-level timeout covers the full pipeline
    // (download + OCR + parse + normalize + persist). The two timeouts
    // overlap intentionally: the download timeout is a safety net for stuck
    // HTTP connections, while the route timeout bounds total processing time.
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
      sourceUrl:      string;
      dishes:         z.infer<typeof NormalizedDishDataSchema>[];
      skippedReasons: IngestImageUrlSkippedReason[];
    }> => {
      const scrapedAt = new Date().toISOString();

      // -----------------------------------------------------------------------
      // Step 4: Download image via HTTP/HTTPS
      // -----------------------------------------------------------------------
      const { buffer } = await downloadImage(url); // throws FETCH_FAILED, INVALID_IMAGE, PAYLOAD_TOO_LARGE

      // -----------------------------------------------------------------------
      // Step 5: Validate magic bytes — JPEG (FFD8FF) or PNG (89504E47)
      // -----------------------------------------------------------------------
      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isPng  = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;

      if (!isJpeg && !isPng) {
        throw Object.assign(
          new Error('Downloaded file is not a valid image (not JPEG or PNG)'),
          { statusCode: 422, code: 'INVALID_IMAGE' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 6: OCR — extract text lines from image
      // -----------------------------------------------------------------------
      let lines = await extractTextFromImage(buffer); // throws OCR_FAILED (422)

      // -----------------------------------------------------------------------
      // Step 7: Chain-specific text preprocessing
      // -----------------------------------------------------------------------
      if (chainSlug !== undefined) {
        lines = preprocessChainText(chainSlug, lines);
      }

      // -----------------------------------------------------------------------
      // Step 8: Parse nutrition table
      // -----------------------------------------------------------------------
      const rawDishes = parseNutritionTable(lines, url, scrapedAt);

      if (rawDishes.length === 0) {
        throw Object.assign(
          new Error('No nutritional data found in image'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 9: Normalize dishes
      // -----------------------------------------------------------------------
      const validDishes: z.infer<typeof NormalizedDishDataSchema>[] = [];
      const skippedReasons: IngestImageUrlSkippedReason[] = [];

      for (const raw of rawDishes) {
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
      // Step 10: Persist (only if dryRun === false)
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

      return {
        dishesFound:    rawDishes.length,
        dishesUpserted,
        dishesSkipped:  skippedReasons.length,
        dryRun,
        sourceUrl:      url,
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

export const ingestImageUrlRoutes = fastifyPlugin(ingestImageUrlRoutesPlugin);
