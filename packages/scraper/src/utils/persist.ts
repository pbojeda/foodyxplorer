// Shared persistence utility for chain scrapers.
//
// Implements the upsert algorithm for Dish + DishNutrient.
// Used by all chain scrapers (F008+) via their persistDish() override.
//
// Algorithm:
//   1. findFirst by (restaurantId, externalId) if externalId present,
//      else by (restaurantId, name).
//   2. dish.create (new) or dish.update (existing).
//   3. dishNutrient.upsert on @@unique([dishId, sourceId]).
//   All three in a single $transaction — last-write-wins.

import { Prisma, PrismaClient } from '@prisma/client';
import type { NormalizedDishData } from '../base/types.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Converts all numeric nutrient fields from NormalizedDishData to Prisma.Decimal
 * instances and includes the non-numeric fields (referenceBasis, estimationMethod,
 * confidenceLevel, extra). This shape matches the DishNutrient create/update data.
 */
function nutrientFields(dish: NormalizedDishData): {
  calories: Prisma.Decimal;
  proteins: Prisma.Decimal;
  carbohydrates: Prisma.Decimal;
  sugars: Prisma.Decimal;
  fats: Prisma.Decimal;
  saturatedFats: Prisma.Decimal;
  fiber: Prisma.Decimal;
  salt: Prisma.Decimal;
  sodium: Prisma.Decimal;
  transFats: Prisma.Decimal;
  cholesterol: Prisma.Decimal;
  potassium: Prisma.Decimal;
  monounsaturatedFats: Prisma.Decimal;
  polyunsaturatedFats: Prisma.Decimal;
  referenceBasis: NormalizedDishData['nutrients']['referenceBasis'];
  estimationMethod: NormalizedDishData['estimationMethod'];
  confidenceLevel: NormalizedDishData['confidenceLevel'];
  extra: NormalizedDishData['nutrients']['extra'] | typeof Prisma.JsonNull;
} {
  const n = dish.nutrients;
  return {
    calories:            new Prisma.Decimal(n.calories),
    proteins:            new Prisma.Decimal(n.proteins),
    carbohydrates:       new Prisma.Decimal(n.carbohydrates),
    sugars:              new Prisma.Decimal(n.sugars),
    fats:                new Prisma.Decimal(n.fats),
    saturatedFats:       new Prisma.Decimal(n.saturatedFats),
    fiber:               new Prisma.Decimal(n.fiber),
    salt:                new Prisma.Decimal(n.salt),
    sodium:              new Prisma.Decimal(n.sodium),
    transFats:           new Prisma.Decimal(n.transFats),
    cholesterol:         new Prisma.Decimal(n.cholesterol),
    potassium:           new Prisma.Decimal(n.potassium),
    monounsaturatedFats: new Prisma.Decimal(n.monounsaturatedFats),
    polyunsaturatedFats: new Prisma.Decimal(n.polyunsaturatedFats),
    referenceBasis:      n.referenceBasis,
    estimationMethod:    dish.estimationMethod,
    confidenceLevel:     dish.confidenceLevel,
    // Prisma nullable JSON fields require Prisma.JsonNull (not JS null) for explicit null
    extra:               n.extra !== undefined ? n.extra : Prisma.JsonNull,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upserts a normalized dish and its nutrients into the database.
 *
 * Steps:
 *   1. Find existing Dish by (restaurantId, externalId) if externalId is
 *      present, else by (restaurantId, name).
 *   2. Create or update the Dish row.
 *   3. Upsert DishNutrient on the compound key (dishId, sourceId).
 *
 * All writes run inside a single Prisma $transaction. If the transaction
 * fails, the error is re-thrown — BaseScraper catches it, increments
 * dishesSkipped, and logs the error.
 *
 * Note: Dish lacks @@unique([restaurantId, name]), so we cannot use
 * Prisma's native upsert — we use findFirst + conditional create/update.
 *
 * @param prisma - The PrismaClient instance (real or mock).
 * @param dish   - Validated, normalized dish data ready for the DB.
 */
export async function persistDishUtil(
  prisma: PrismaClient,
  dish: NormalizedDishData,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Step 1: Look up existing dish
    const whereClause = dish.externalId !== undefined
      ? { restaurantId: dish.restaurantId, externalId: dish.externalId }
      : { restaurantId: dish.restaurantId, name: dish.name };

    const existing = await tx.dish.findFirst({
      where: whereClause,
      select: { id: true },
    });

    // Step 2: Create or update the Dish row
    let dishId: string;

    if (existing !== null) {
      await tx.dish.update({
        where: { id: existing.id },
        data: {
          name:             dish.name,
          nameEs:           dish.nameEs ?? null,
          description:      dish.description ?? null,
          externalId:       dish.externalId ?? null,
          availability:     dish.availability,
          portionGrams:     dish.portionGrams !== undefined ? new Prisma.Decimal(dish.portionGrams) : null,
          priceEur:         dish.priceEur !== undefined ? new Prisma.Decimal(dish.priceEur) : null,
          aliases:          dish.aliases,
          confidenceLevel:  dish.confidenceLevel,
          estimationMethod: dish.estimationMethod,
        },
      });
      dishId = existing.id;
    } else {
      const created = await tx.dish.create({
        data: {
          restaurantId:     dish.restaurantId,
          sourceId:         dish.sourceId,
          name:             dish.name,
          nameEs:           dish.nameEs ?? null,
          description:      dish.description ?? null,
          externalId:       dish.externalId ?? null,
          availability:     dish.availability,
          portionGrams:     dish.portionGrams !== undefined ? new Prisma.Decimal(dish.portionGrams) : null,
          priceEur:         dish.priceEur !== undefined ? new Prisma.Decimal(dish.priceEur) : null,
          aliases:          dish.aliases,
          confidenceLevel:  dish.confidenceLevel,
          estimationMethod: dish.estimationMethod,
        },
        select: { id: true },
      });
      dishId = created.id;
    }

    // Step 3: Upsert DishNutrient on the @@unique([dishId, sourceId]) constraint
    await tx.dishNutrient.upsert({
      where: {
        dishId_sourceId: { dishId, sourceId: dish.sourceId },
      },
      create: {
        dishId,
        sourceId: dish.sourceId,
        ...nutrientFields(dish),
      },
      update: {
        ...nutrientFields(dish),
      },
    });
  });
}
