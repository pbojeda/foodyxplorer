// POST /ingest/url — URL nutritional data ingestion route.
//
// Accepts a JSON body with a URL, restaurantId, sourceId, and optional dryRun flag.
// Fetches the page HTML via htmlFetcher (Crawlee/Playwright), extracts text via
// htmlTextExtractor (node-html-parser), parses nutritional tables through
// parseNutritionTable, normalizes via normalizeNutrients/normalizeDish, and
// persists via Prisma upsert.
//
// Plugin options: { prisma: PrismaClient }
//
// Error codes: VALIDATION_ERROR (400), NOT_FOUND (404), INVALID_URL (422),
//              FETCH_FAILED (422), SCRAPER_BLOCKED (422),
//              NO_NUTRITIONAL_DATA_FOUND (422), PROCESSING_TIMEOUT (408),
//              DB_UNAVAILABLE (500)

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { type PrismaClient, Prisma } from '@prisma/client';
import {
  normalizeNutrients,
  normalizeDish,
  NormalizedDishDataSchema,
} from '@foodxplorer/scraper';

import { fetchHtml } from '../../lib/htmlFetcher.js';
import { extractTextFromHtml } from '../../lib/htmlTextExtractor.js';
import { parseNutritionTable } from '../../ingest/nutritionTableParser.js';

// ---------------------------------------------------------------------------
// Zod schemas (API-internal)
// ---------------------------------------------------------------------------

const IngestUrlBodySchema = z.object({
  url: z.string().url().max(2048),
  restaurantId: z.string().uuid(),
  sourceId: z.string().uuid(),
  dryRun: z.boolean().default(false),
});

interface IngestUrlSkippedReason {
  dishName: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// SSRF guard — blocks private/loopback hostnames
// ---------------------------------------------------------------------------

const SSRF_BLOCKED =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/i;

// ---------------------------------------------------------------------------
// Domain error codes — used in the Prisma catch block to re-throw
// ---------------------------------------------------------------------------

const DOMAIN_CODES = new Set([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INVALID_URL',
  'FETCH_FAILED',
  'SCRAPER_BLOCKED',
  'NO_NUTRITIONAL_DATA_FOUND',
  'PROCESSING_TIMEOUT',
]);

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface IngestUrlPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const ingestUrlRoutesPlugin: FastifyPluginAsync<IngestUrlPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  app.post('/ingest/url', async (request, reply) => {
    // -------------------------------------------------------------------------
    // Step 1: Parse JSON body
    // -------------------------------------------------------------------------
    const parseResult = IngestUrlBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw parseResult.error; // ZodError — error handler maps to 400 VALIDATION_ERROR
    }

    const { url, restaurantId, sourceId, dryRun } = parseResult.data;

    // -------------------------------------------------------------------------
    // Step 2: URL sanity check — scheme + SSRF guard
    // -------------------------------------------------------------------------
    const parsedUrl = new URL(url); // Safe: Zod already validated it is a URL

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw Object.assign(
        new Error('URL must use http or https scheme'),
        { statusCode: 422, code: 'INVALID_URL' },
      );
    }

    if (SSRF_BLOCKED.test(parsedUrl.hostname)) {
      throw Object.assign(
        new Error('URL targets a private or loopback address'),
        { statusCode: 422, code: 'INVALID_URL' },
      );
    }

    // -------------------------------------------------------------------------
    // Step 3: DB existence checks (run regardless of dryRun)
    // -------------------------------------------------------------------------
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true },
    });
    if (restaurant === null) {
      throw Object.assign(
        new Error('Restaurant not found'),
        { statusCode: 404, code: 'NOT_FOUND' },
      );
    }

    const dataSource = await prisma.dataSource.findUnique({
      where: { id: sourceId },
      select: { id: true },
    });
    if (dataSource === null) {
      throw Object.assign(
        new Error('Data source not found'),
        { statusCode: 404, code: 'NOT_FOUND' },
      );
    }

    // -------------------------------------------------------------------------
    // Steps 4–8: Processing pipeline wrapped in 30-second timeout
    // -------------------------------------------------------------------------
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          Object.assign(new Error('Processing timeout'), {
            statusCode: 408,
            code: 'PROCESSING_TIMEOUT',
          }),
        );
      }, 30_000);
    });

    const processingPromise = async (): Promise<{
      dishesFound: number;
      dishesUpserted: number;
      dishesSkipped: number;
      dryRun: boolean;
      sourceUrl: string;
      dishes: z.infer<typeof NormalizedDishDataSchema>[];
      skippedReasons: IngestUrlSkippedReason[];
    }> => {
      const scrapedAt = new Date().toISOString();

      // -----------------------------------------------------------------------
      // Step 4: Fetch HTML via Crawlee/Playwright
      // -----------------------------------------------------------------------
      const html = await fetchHtml(url); // throws FETCH_FAILED or SCRAPER_BLOCKED

      // -----------------------------------------------------------------------
      // Step 5: Extract text lines from HTML
      // -----------------------------------------------------------------------
      const lines = extractTextFromHtml(html);

      if (lines.length === 0) {
        throw Object.assign(
          new Error('No extractable text found in fetched HTML'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 6: Parse nutrition table
      // -----------------------------------------------------------------------
      const rawDishes = parseNutritionTable(lines, url, scrapedAt);

      if (rawDishes.length === 0) {
        throw Object.assign(
          new Error('No nutritional data found in fetched HTML'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 7: Normalize dishes
      // -----------------------------------------------------------------------
      const validDishes: z.infer<typeof NormalizedDishDataSchema>[] = [];
      const skippedReasons: IngestUrlSkippedReason[] = [];

      for (const raw of rawDishes) {
        // Normalize nutrients — returns null if required fields missing or calorie > 9000
        const normalizedNutrients = normalizeNutrients(raw.nutrients);
        if (normalizedNutrients === null) {
          skippedReasons.push({
            dishName: raw.name,
            reason: 'Missing required nutrient fields or calorie limit exceeded',
          });
          continue;
        }

        // Normalize dish metadata
        const dishMeta = normalizeDish(raw, { sourceId, restaurantId });

        // Merge and validate through NormalizedDishDataSchema
        const merged = { ...dishMeta, nutrients: normalizedNutrients };
        const schemaResult = NormalizedDishDataSchema.safeParse(merged);
        if (!schemaResult.success) {
          const firstIssue = schemaResult.error.issues[0];
          skippedReasons.push({
            dishName: raw.name,
            reason: firstIssue?.message ?? 'Validation failed',
          });
          continue;
        }

        validDishes.push(schemaResult.data);
      }

      if (validDishes.length === 0) {
        throw Object.assign(
          new Error('No nutritional data found in fetched HTML'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 8: Persist (only if dryRun === false)
      // -----------------------------------------------------------------------
      let dishesUpserted = 0;

      if (!dryRun) {
        try {
          await prisma.$transaction(async (tx) => {
            for (const dish of validDishes) {
              // findFirst + create/update (no @@unique([restaurantId, name]) in Prisma schema)
              const existing = await tx.dish.findFirst({
                where: { restaurantId: dish.restaurantId, name: dish.name },
                select: { id: true },
              });

              let dishId: string;

              if (existing === null) {
                const created = await tx.dish.create({
                  data: {
                    restaurantId: dish.restaurantId,
                    sourceId: dish.sourceId,
                    name: dish.name,
                    nameEs: dish.nameEs,
                    description: dish.description,
                    externalId: dish.externalId,
                    availability: dish.availability,
                    portionGrams: dish.portionGrams,
                    priceEur: dish.priceEur,
                    confidenceLevel: dish.confidenceLevel,
                    estimationMethod: dish.estimationMethod,
                    aliases: dish.aliases,
                  },
                  select: { id: true },
                });
                dishId = created.id;
              } else {
                await tx.dish.update({
                  where: { id: existing.id },
                  data: {
                    sourceId: dish.sourceId,
                    nameEs: dish.nameEs,
                    description: dish.description,
                    availability: dish.availability,
                    portionGrams: dish.portionGrams,
                    priceEur: dish.priceEur,
                    confidenceLevel: dish.confidenceLevel,
                    estimationMethod: dish.estimationMethod,
                    aliases: dish.aliases,
                  },
                });
                dishId = existing.id;
              }

              // Upsert dish nutrients
              const existingNutrient = await tx.dishNutrient.findFirst({
                where: { dishId, sourceId: dish.sourceId },
                select: { id: true },
              });

              const nutrientData = {
                dishId,
                sourceId: dish.sourceId,
                confidenceLevel: dish.confidenceLevel,
                estimationMethod: dish.estimationMethod,
                calories: dish.nutrients.calories,
                proteins: dish.nutrients.proteins,
                carbohydrates: dish.nutrients.carbohydrates,
                sugars: dish.nutrients.sugars,
                fats: dish.nutrients.fats,
                saturatedFats: dish.nutrients.saturatedFats,
                fiber: dish.nutrients.fiber,
                salt: dish.nutrients.salt,
                sodium: dish.nutrients.sodium,
                transFats: dish.nutrients.transFats,
                cholesterol: dish.nutrients.cholesterol,
                potassium: dish.nutrients.potassium,
                monounsaturatedFats: dish.nutrients.monounsaturatedFats,
                polyunsaturatedFats: dish.nutrients.polyunsaturatedFats,
                referenceBasis: dish.nutrients.referenceBasis,
                extra: dish.nutrients.extra !== undefined
                  ? (dish.nutrients.extra as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
              };

              if (existingNutrient === null) {
                await tx.dishNutrient.create({ data: nutrientData });
              } else {
                await tx.dishNutrient.update({
                  where: { id: existingNutrient.id },
                  data: nutrientData,
                });
              }

              dishesUpserted++;
            }
          });
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
        dishesFound: rawDishes.length,
        dishesUpserted,
        dishesSkipped: skippedReasons.length,
        dryRun,
        sourceUrl: url,
        dishes: validDishes,
        skippedReasons,
      };
    };

    try {
      const result = await Promise.race([processingPromise(), timeoutPromise]);

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  });
};

export const ingestUrlRoutes = fastifyPlugin(ingestUrlRoutesPlugin);
