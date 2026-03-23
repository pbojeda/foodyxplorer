// POST /ingest/pdf — PDF nutritional data ingestion route.
//
// Accepts a multipart PDF upload, extracts text, parses nutritional tables,
// normalizes through the scraper pipeline, and persists via Prisma upsert.
//
// Plugin options: { prisma: PrismaClient }
//
// Error codes: VALIDATION_ERROR (400), NOT_FOUND (404), INVALID_PDF (422),
//              UNSUPPORTED_PDF (422), NO_NUTRITIONAL_DATA_FOUND (422),
//              PROCESSING_TIMEOUT (408), DB_UNAVAILABLE (500)

import path from 'path';
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

import { extractText } from '../../lib/pdfParser.js';
import { parseNutritionTable } from '../../ingest/nutritionTableParser.js';

// ---------------------------------------------------------------------------
// Zod schemas (API-internal)
// ---------------------------------------------------------------------------

const IngestPdfBodySchema = z.object({
  restaurantId: z.string().uuid(),
  sourceId: z.string().uuid(),
  dryRun: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
});

interface IngestPdfSkippedReason {
  dishName: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface IngestPdfPluginOptions {
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const ingestPdfRoutesPlugin: FastifyPluginAsync<IngestPdfPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma } = opts;

  app.post('/ingest/pdf', async (request, reply) => {
    // -------------------------------------------------------------------------
    // Step 1: Parse multipart stream
    // -------------------------------------------------------------------------
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | undefined;
    let originalFilename = 'upload';

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (fileBuffer === undefined) {
          // Only process the first file part
          const filePart = part as MultipartFilePart;
          originalFilename = filePart.filename ?? 'upload';
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
    // Step 2: Validate non-file fields
    // -------------------------------------------------------------------------
    if (fileBuffer === undefined) {
      throw Object.assign(
        new Error('Missing file part in multipart request'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    const parseResult = IngestPdfBodySchema.safeParse(fields);
    if (!parseResult.success) {
      throw parseResult.error;
    }

    const { restaurantId, sourceId, dryRun } = parseResult.data;

    // -------------------------------------------------------------------------
    // Step 3: Validate file magic bytes
    // -------------------------------------------------------------------------
    const magicBytes = fileBuffer.subarray(0, 5).toString('ascii');
    if (magicBytes !== '%PDF-') {
      throw Object.assign(
        new Error('File is not a valid PDF'),
        { statusCode: 422, code: 'INVALID_PDF' },
      );
    }

    // -------------------------------------------------------------------------
    // Step 4: DB existence checks (runs regardless of dryRun)
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
    // Step 5: Sanitize filename and build sourceUrl
    // -------------------------------------------------------------------------
    const baseName = path.basename(originalFilename);
    const sanitizedFilename =
      baseName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
    const sourceUrl = `pdf://${sanitizedFilename}`;

    // -------------------------------------------------------------------------
    // Steps 6–9: Processing pipeline wrapped in 30-second timeout
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
      dishes: z.infer<typeof NormalizedDishDataSchema>[];
      skippedReasons: IngestPdfSkippedReason[];
    }> => {
      const scrapedAt = new Date().toISOString();

      // -----------------------------------------------------------------------
      // Step 6: Extract text from PDF
      // -----------------------------------------------------------------------
      const pages = await extractText(fileBuffer as Buffer); // may throw UNSUPPORTED_PDF

      // -----------------------------------------------------------------------
      // Step 7: Parse nutrition table
      // -----------------------------------------------------------------------
      const allText = pages.join('\n');
      const lines = allText.split('\n');
      const rawDishes = parseNutritionTable(lines, sourceUrl, scrapedAt);

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
      const skippedReasons: IngestPdfSkippedReason[] = [];

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
              // Use findFirst + create/update since there's no @@unique([restaurantId, name])
              // in the Prisma schema — the DB has a partial unique index on externalId only.
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
          }, { maxWait: 30_000, timeout: 120_000 });
        } catch (err) {
          // Re-throw domain errors — let the global error handler deal with them
          const DOMAIN_CODES = new Set([
            'VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_PDF',
            'UNSUPPORTED_PDF', 'NO_NUTRITIONAL_DATA_FOUND', 'PROCESSING_TIMEOUT',
          ]);
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

export const ingestPdfRoutes = fastifyPlugin(ingestPdfRoutesPlugin);
