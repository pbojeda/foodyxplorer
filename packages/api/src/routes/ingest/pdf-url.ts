// POST /ingest/pdf-url — PDF URL nutritional data ingestion route.
//
// Accepts a JSON body with a URL pointing to a PDF file, downloads it using
// pdfDownloader (Node.js built-in fetch, 30-second timeout, 20 MB size cap),
// validates the PDF bytes, extracts text, parses nutritional tables, normalizes
// and persists via Prisma upsert.
//
// Plugin options: { prisma: PrismaClient }
//
// Error codes: VALIDATION_ERROR (400), NOT_FOUND (404), PROCESSING_TIMEOUT (408),
//              PAYLOAD_TOO_LARGE (413), INVALID_URL (422), FETCH_FAILED (422),
//              INVALID_PDF (422), UNSUPPORTED_PDF (422),
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
import { downloadPdf } from '../../lib/pdfDownloader.js';
import { extractText } from '../../lib/pdfParser.js';
import { parseNutritionTable } from '../../ingest/nutritionTableParser.js';

// ---------------------------------------------------------------------------
// Zod schemas (API-internal)
// ---------------------------------------------------------------------------

const IngestPdfUrlBodySchema = z.object({
  url: z.string().url().max(2048),
  restaurantId: z.string().uuid(),
  sourceId: z.string().uuid(),
  dryRun: z.boolean().default(false),
});

interface IngestPdfUrlSkippedReason {
  dishName: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Domain error codes — used in the Prisma catch block to re-throw
// ---------------------------------------------------------------------------

const DOMAIN_CODES = new Set([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INVALID_URL',
  'FETCH_FAILED',
  'INVALID_PDF',
  'UNSUPPORTED_PDF',
  'NO_NUTRITIONAL_DATA_FOUND',
  'PROCESSING_TIMEOUT',
  'PAYLOAD_TOO_LARGE',
]);

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface IngestPdfUrlPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const ingestPdfUrlRoutesPlugin: FastifyPluginAsync<IngestPdfUrlPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  app.post('/ingest/pdf-url', async (request, reply) => {
    // -------------------------------------------------------------------------
    // Step 1: Parse JSON body
    // -------------------------------------------------------------------------
    const parseResult = IngestPdfUrlBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw parseResult.error; // ZodError — error handler maps to 400 VALIDATION_ERROR
    }

    const { url, restaurantId, sourceId, dryRun } = parseResult.data;

    // -------------------------------------------------------------------------
    // Step 2: URL sanity check — scheme + SSRF guard
    // -------------------------------------------------------------------------
    assertNotSsrf(url); // throws INVALID_URL (422) if blocked

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
      skippedReasons: IngestPdfUrlSkippedReason[];
    }> => {
      const scrapedAt = new Date().toISOString();

      // -----------------------------------------------------------------------
      // Step 4: Download PDF via HTTP/HTTPS
      // -----------------------------------------------------------------------
      const fileBuffer = await downloadPdf(url); // throws FETCH_FAILED, INVALID_PDF, PAYLOAD_TOO_LARGE

      // -----------------------------------------------------------------------
      // Step 5: Validate PDF magic bytes
      // -----------------------------------------------------------------------
      const magicBytes = fileBuffer.subarray(0, 5).toString('ascii');
      if (magicBytes !== '%PDF-') {
        throw Object.assign(
          new Error('Downloaded file is not a valid PDF'),
          { statusCode: 422, code: 'INVALID_PDF' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 6: Extract text from PDF
      // -----------------------------------------------------------------------
      const pages = await extractText(fileBuffer); // may throw UNSUPPORTED_PDF

      // -----------------------------------------------------------------------
      // Step 7: Parse nutrition table
      // -----------------------------------------------------------------------
      const allText = pages.join('\n');
      const lines = allText.split('\n');
      const rawDishes = parseNutritionTable(lines, url, scrapedAt);

      if (rawDishes.length === 0) {
        throw Object.assign(
          new Error('No nutritional data found in PDF'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 8: Normalize dishes
      // -----------------------------------------------------------------------
      const validDishes: z.infer<typeof NormalizedDishDataSchema>[] = [];
      const skippedReasons: IngestPdfUrlSkippedReason[] = [];

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
          new Error('No nutritional data found in PDF'),
          { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
        );
      }

      // -----------------------------------------------------------------------
      // Step 9: Persist (only if dryRun === false)
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

export const ingestPdfUrlRoutes = fastifyPlugin(ingestPdfUrlRoutesPlugin);
