// Catalog routes — read-only browsing endpoints (F025).
//
// GET /restaurants         — paginated restaurant list with dishCount
// GET /restaurants/:id/dishes — paginated dish list for a restaurant
// GET /dishes/search       — trigram similarity search across all dishes
// GET /chains              — flat chain list with aggregated dishCount
// POST /restaurants        — create a new restaurant (admin, F032)
//
// Prisma for simple list/filter queries.
// Kysely for trigram search queries (requires raw SQL fragments).
// Redis cache: 60s TTL, fail-open on all errors.

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Kysely, SqlBool } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import {
  RestaurantListQuerySchema,
  RestaurantDishParamsSchema,
  RestaurantDishListQuerySchema,
  DishSearchQuerySchema,
  ChainListQuerySchema,
  CreateRestaurantBodySchema,
  type RestaurantListItem,
  type DishListItem,
  type ChainListItem,
  type CreateRestaurantBody,
} from '@foodxplorer/shared';
import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';
import { generateIndependentSlug } from '../utils/slugify.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface CatalogPluginOptions {
  prisma: PrismaClient;
  db: Kysely<DB>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

// Prisma dish row with nested restaurant relation
type PrismaDishWithRestaurant = Prisma.DishGetPayload<{
  include: { restaurant: { select: { name: true; chainSlug: true } } };
}>;

// Kysely trigram query row — dishes
interface KyselyDishRow {
  id: string;
  name: string;
  name_es: string | null;
  restaurant_id: string;
  chain_slug: string;
  restaurant_name: string;
  availability: string;
  portion_grams: string | null;
  price_eur: string | null;
}

// Kysely trigram query row — restaurants (F032)
interface KyselyRestaurantRow {
  id: string;
  name: string;
  name_es: string | null;
  chain_slug: string;
  country_code: string;
  is_active: boolean;
  logo_url: string | null;
  website: string | null;
  address: string | null;
  dish_count: string; // COUNT returns string from pg driver
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * Map a Prisma dish row (camelCase + nested restaurant) to DishListItem.
 * Prisma.Decimal fields are converted to number via .toNumber().
 */
function mapPrismaDishRow(row: PrismaDishWithRestaurant): DishListItem {
  return {
    id: row.id,
    name: row.name,
    nameEs: row.nameEs,
    restaurantId: row.restaurantId,
    chainSlug: row.restaurant.chainSlug,
    restaurantName: row.restaurant.name,
    availability: row.availability as DishListItem['availability'],
    portionGrams: row.portionGrams ? (row.portionGrams as unknown as Prisma.Decimal).toNumber() : null,
    priceEur: row.priceEur ? (row.priceEur as unknown as Prisma.Decimal).toNumber() : null,
  };
}

/**
 * Map a Kysely flat row (snake_case) to DishListItem.
 * Decimal-like columns arrive as string from the pg driver — use Number().
 */
function mapKyselyDishRow(row: KyselyDishRow): DishListItem {
  return {
    id: row.id,
    name: row.name,
    nameEs: row.name_es,
    restaurantId: row.restaurant_id,
    chainSlug: row.chain_slug,
    restaurantName: row.restaurant_name,
    availability: row.availability as DishListItem['availability'],
    portionGrams: row.portion_grams ? Number(row.portion_grams) : null,
    priceEur: row.price_eur ? Number(row.price_eur) : null,
  };
}

/**
 * Map a Kysely flat row (snake_case) to RestaurantListItem.
 * dish_count arrives as a string from COUNT — convert with Number().
 */
function mapKyselyRestaurantRow(row: KyselyRestaurantRow): RestaurantListItem {
  return {
    id: row.id,
    name: row.name,
    nameEs: row.name_es,
    chainSlug: row.chain_slug,
    countryCode: row.country_code,
    isActive: row.is_active,
    logoUrl: row.logo_url,
    website: row.website,
    address: row.address,
    dishCount: Number(row.dish_count),
  };
}

// ---------------------------------------------------------------------------
// Cache key helper
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic JSON string (keys sorted) for use as cache sub-key.
 * JSON.stringify does NOT sort keys by default — this ensures stability.
 */
function stableKey(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const catalogRoutesPlugin: FastifyPluginAsync<CatalogPluginOptions> = async (
  app,
  opts,
) => {
  const { prisma, db } = opts;

  // -------------------------------------------------------------------------
  // GET /restaurants
  // -------------------------------------------------------------------------

  app.get(
    '/restaurants',
    {
      schema: {
        querystring: RestaurantListQuerySchema,
        tags: ['Catalog'],
        operationId: 'listRestaurants',
        summary: 'List restaurants',
        description:
          'Returns a paginated list of restaurants. ' +
          'Optionally filter by countryCode, chainSlug, or isActive status. ' +
          'Each item includes dishCount (number of dishes for that restaurant). ' +
          'Responses are cached for 60 seconds.',
      },
    },
    async (request, reply) => {
      const { countryCode, chainSlug, isActive, page, pageSize, q } =
        request.query as {
          countryCode?: string;
          chainSlug?: string;
          isActive?: boolean;
          page: number;
          pageSize: number;
          q?: string;
        };

      const cacheKey = buildKey('restaurants', stableKey({ countryCode, chainSlug, isActive, page, pageSize, q }));

      const cached = await cacheGet<{ items: RestaurantListItem[]; pagination: unknown }>(cacheKey, request.log);
      if (cached !== null) {
        return reply.send({ success: true, data: cached });
      }

      let items: RestaurantListItem[];
      let totalItems: number;

      try {
        if (q) {
          // Kysely trigram path — similarity search on restaurant name
          let query = db
            .selectFrom('restaurants as r')
            .select([
              'r.id',
              'r.name',
              'r.name_es',
              'r.chain_slug',
              'r.country_code',
              'r.is_active',
              'r.logo_url',
              'r.website',
              'r.address',
              sql<string>`(SELECT COUNT(*) FROM dishes WHERE restaurant_id = r.id)`.as('dish_count'),
            ])
            .where(sql<SqlBool>`similarity(r.name, ${q}) > 0.15`);

          if (countryCode !== undefined) {
            query = query.where('r.country_code', '=', countryCode);
          }
          if (chainSlug !== undefined) {
            query = query.where('r.chain_slug', '=', chainSlug);
          }
          if (isActive !== undefined) {
            query = query.where('r.is_active', '=', isActive);
          }

          // Count query with same filters
          let countQuery = db
            .selectFrom('restaurants as r')
            .select(db.fn.countAll().as('count'))
            .where(sql<SqlBool>`similarity(r.name, ${q}) > 0.15`);

          if (countryCode !== undefined) {
            countQuery = countQuery.where('r.country_code', '=', countryCode);
          }
          if (chainSlug !== undefined) {
            countQuery = countQuery.where('r.chain_slug', '=', chainSlug);
          }
          if (isActive !== undefined) {
            countQuery = countQuery.where('r.is_active', '=', isActive);
          }

          const countResult = await countQuery.executeTakeFirstOrThrow();
          totalItems = Number(countResult.count);

          const rows = await query
            .orderBy(sql`similarity(r.name, ${q}) DESC`)
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .execute();

          items = (rows as unknown as KyselyRestaurantRow[]).map(mapKyselyRestaurantRow);
        } else {
          // Prisma path (existing behaviour — unchanged)
          const where = {
            ...(countryCode !== undefined && { countryCode }),
            ...(chainSlug !== undefined && { chainSlug }),
            ...(isActive !== undefined && { isActive }),
          };

          const [rows, count] = await Promise.all([
            prisma.restaurant.findMany({
              where,
              include: { _count: { select: { dishes: true } } },
              orderBy: { name: 'asc' },
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            prisma.restaurant.count({ where }),
          ]);

          totalItems = count;
          items = rows.map(({ _count, ...rest }) => ({
            id: rest.id,
            name: rest.name,
            nameEs: rest.nameEs,
            chainSlug: rest.chainSlug,
            countryCode: rest.countryCode,
            isActive: rest.isActive,
            logoUrl: rest.logoUrl,
            website: rest.website,
            address: rest.address ?? null,
            dishCount: _count.dishes,
          }));
        }
      } catch {
        throw Object.assign(
          new Error('Database query failed'),
          { code: 'DB_UNAVAILABLE' },
        );
      }

      const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
      const data = {
        items,
        pagination: { page, pageSize, totalItems, totalPages },
      };

      await cacheSet(cacheKey, data, request.log, { ttl: 60 });

      return reply.send({ success: true, data });
    },
  );

  // -------------------------------------------------------------------------
  // GET /restaurants/:id/dishes
  // -------------------------------------------------------------------------

  app.get(
    '/restaurants/:id/dishes',
    {
      schema: {
        params: RestaurantDishParamsSchema,
        querystring: RestaurantDishListQuerySchema,
        tags: ['Catalog'],
        operationId: 'listRestaurantDishes',
        summary: 'List dishes for a restaurant',
        description:
          'Returns a paginated list of dishes for a specific restaurant. ' +
          'Without ?search uses Prisma (name ASC). ' +
          'With ?search uses Kysely trigram similarity (threshold ≥ 0.15). ' +
          'Returns 404 if the restaurant does not exist.',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { search, availability, page, pageSize } = request.query as {
        search?: string;
        availability?: DishListItem['availability'];
        page: number;
        pageSize: number;
      };

      const cacheKey = buildKey(
        'restaurant-dishes',
        stableKey({ id, search, availability, page, pageSize }),
      );

      const cached = await cacheGet<{ items: DishListItem[]; pagination: unknown }>(cacheKey, request.log);
      if (cached !== null) {
        return reply.send({ success: true, data: cached });
      }

      // --- Existence check ---
      let restaurantExists: boolean;
      try {
        const restaurant = await prisma.restaurant.findUnique({ where: { id } });
        restaurantExists = restaurant !== null;
      } catch {
        throw Object.assign(
          new Error('Database query failed'),
          { code: 'DB_UNAVAILABLE' },
        );
      }

      if (!restaurantExists) {
        throw Object.assign(
          new Error('Restaurant not found'),
          { code: 'NOT_FOUND', statusCode: 404 },
        );
      }

      let items: DishListItem[];
      let totalItems: number;

      try {
        if (search) {
          // Kysely trigram path
          const baseQuery = db
            .selectFrom('dishes as d')
            .innerJoin('restaurants as r', 'r.id', 'd.restaurant_id')
            .select([
              'd.id',
              'd.name',
              'd.name_es',
              'd.restaurant_id',
              'd.availability',
              'd.portion_grams',
              'd.price_eur',
              'r.name as restaurant_name',
              'r.chain_slug as chain_slug',
            ])
            .where(
              sql<SqlBool>`(similarity(d.name, ${search}) > 0.15 OR similarity(d.name_es, ${search}) > 0.15)`,
            )
            .where('d.restaurant_id', '=', id);

          const filteredQuery = availability
            ? baseQuery.where('d.availability', '=', availability)
            : baseQuery;

          const countResult = await db
            .selectFrom('dishes as d')
            .innerJoin('restaurants as r', 'r.id', 'd.restaurant_id')
            .select(db.fn.countAll().as('count'))
            .where(
              sql<SqlBool>`(similarity(d.name, ${search}) > 0.15 OR similarity(d.name_es, ${search}) > 0.15)`,
            )
            .where('d.restaurant_id', '=', id)
            .$if(availability !== undefined, qb => qb.where('d.availability', '=', availability as DishListItem['availability']))
            .executeTakeFirstOrThrow();

          totalItems = Number(countResult.count);

          const rows = await filteredQuery
            .orderBy(sql`GREATEST(similarity(d.name, ${search}), similarity(d.name_es, ${search})) DESC`)
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .execute();

          items = (rows as unknown as KyselyDishRow[]).map(mapKyselyDishRow);
        } else {
          // Prisma path
          const where = {
            restaurantId: id,
            ...(availability !== undefined && { availability }),
          };

          const [rows, count] = await Promise.all([
            prisma.dish.findMany({
              where,
              include: { restaurant: { select: { name: true, chainSlug: true } } },
              orderBy: { name: 'asc' },
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            prisma.dish.count({ where }),
          ]);

          totalItems = count;
          items = rows.map(row => mapPrismaDishRow(row as PrismaDishWithRestaurant));
        }
      } catch {
        throw Object.assign(
          new Error('Database query failed'),
          { code: 'DB_UNAVAILABLE' },
        );
      }

      const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
      const data = {
        items,
        pagination: { page, pageSize, totalItems, totalPages },
      };

      await cacheSet(cacheKey, data, request.log, { ttl: 60 });

      return reply.send({ success: true, data });
    },
  );

  // -------------------------------------------------------------------------
  // GET /dishes/search
  // -------------------------------------------------------------------------

  app.get(
    '/dishes/search',
    {
      schema: {
        querystring: DishSearchQuerySchema,
        tags: ['Catalog'],
        operationId: 'searchDishes',
        summary: 'Search dishes by name',
        description:
          'Trigram similarity search across all dishes. ' +
          'q is required. Returns empty results (never 404) when no match. ' +
          'restaurantId takes precedence over chainSlug when both are provided.',
      },
    },
    async (request, reply) => {
      const { q, chainSlug, restaurantId, availability, page, pageSize } =
        request.query as {
          q: string;
          chainSlug?: string;
          restaurantId?: string;
          availability?: DishListItem['availability'];
          page: number;
          pageSize: number;
        };

      const cacheKey = buildKey(
        'dishes-search',
        stableKey({ q, chainSlug, restaurantId, availability, page, pageSize }),
      );

      const cached = await cacheGet<{ items: DishListItem[]; pagination: unknown }>(cacheKey, request.log);
      if (cached !== null) {
        return reply.send({ success: true, data: cached });
      }

      let items: DishListItem[];
      let totalItems: number;

      try {
        let query = db
          .selectFrom('dishes as d')
          .innerJoin('restaurants as r', 'r.id', 'd.restaurant_id')
          .select([
            'd.id',
            'd.name',
            'd.name_es',
            'd.restaurant_id',
            'd.availability',
            'd.portion_grams',
            'd.price_eur',
            'r.name as restaurant_name',
            'r.chain_slug as chain_slug',
          ])
          .where(
            sql<SqlBool>`(similarity(d.name, ${q}) > 0.15 OR similarity(d.name_es, ${q}) > 0.15)`,
          );

        // restaurantId takes precedence over chainSlug
        if (restaurantId !== undefined) {
          query = query.where('d.restaurant_id', '=', restaurantId);
        } else if (chainSlug !== undefined) {
          query = query.where('r.chain_slug', '=', chainSlug);
        }

        if (availability !== undefined) {
          query = query.where('d.availability', '=', availability);
        }

        // Build count query with same filters
        let countQuery = db
          .selectFrom('dishes as d')
          .innerJoin('restaurants as r', 'r.id', 'd.restaurant_id')
          .select(db.fn.countAll().as('count'))
          .where(
            sql<SqlBool>`(similarity(d.name, ${q}) > 0.15 OR similarity(d.name_es, ${q}) > 0.15)`,
          );

        if (restaurantId !== undefined) {
          countQuery = countQuery.where('d.restaurant_id', '=', restaurantId);
        } else if (chainSlug !== undefined) {
          countQuery = countQuery.where('r.chain_slug', '=', chainSlug);
        }

        if (availability !== undefined) {
          countQuery = countQuery.where('d.availability', '=', availability);
        }

        const countResult = await countQuery.executeTakeFirstOrThrow();
        totalItems = Number(countResult.count);

        const rows = await query
          .orderBy(sql`GREATEST(similarity(d.name, ${q}), similarity(d.name_es, ${q})) DESC`)
          .limit(pageSize)
          .offset((page - 1) * pageSize)
          .execute();

        items = (rows as unknown as KyselyDishRow[]).map(mapKyselyDishRow);
      } catch {
        throw Object.assign(
          new Error('Database query failed'),
          { code: 'DB_UNAVAILABLE' },
        );
      }

      const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
      const data = {
        items,
        pagination: { page, pageSize, totalItems, totalPages },
      };

      await cacheSet(cacheKey, data, request.log, { ttl: 60 });

      return reply.send({ success: true, data });
    },
  );

  // -------------------------------------------------------------------------
  // GET /chains
  // -------------------------------------------------------------------------

  app.get(
    '/chains',
    {
      schema: {
        querystring: ChainListQuerySchema,
        tags: ['Catalog'],
        operationId: 'listChains',
        summary: 'List chains',
        description:
          'Returns a flat list of chains with aggregated dishCount. ' +
          'A chain entry is created per (chainSlug, countryCode) combination. ' +
          'isActive is true if any restaurant in the group is active. ' +
          'Not paginated — chain count is bounded (~20 max). ' +
          'Responses are cached for 60 seconds.',
      },
    },
    async (request, reply) => {
      const { countryCode, isActive } = request.query as {
        countryCode?: string;
        isActive?: boolean;
      };

      const cacheKey = buildKey('chains', stableKey({ countryCode, isActive }));

      const cached = await cacheGet<ChainListItem[]>(cacheKey, request.log);
      if (cached !== null) {
        return reply.send({ success: true, data: cached });
      }

      let data: ChainListItem[];

      try {
        const rows = await prisma.restaurant.findMany({
          where: {
            ...(countryCode !== undefined && { countryCode }),
            ...(isActive !== undefined && { isActive }),
          },
          include: { _count: { select: { dishes: true } } },
        });

        // Group by (chainSlug, countryCode) — one entry per combination
        const map = new Map<string, ChainListItem>();
        for (const row of rows) {
          const key = `${row.chainSlug}:${row.countryCode}`;
          const existing = map.get(key);
          if (existing) {
            // Accumulate dishCount
            existing.dishCount += row._count.dishes;
            // Chain is active if ANY restaurant in group is active
            if (row.isActive) {
              existing.isActive = true;
            }
          } else {
            map.set(key, {
              chainSlug: row.chainSlug,
              name: row.name,
              nameEs: row.nameEs,
              countryCode: row.countryCode,
              dishCount: row._count.dishes,
              isActive: row.isActive,
            });
          }
        }

        data = Array.from(map.values());
      } catch {
        throw Object.assign(
          new Error('Database query failed'),
          { code: 'DB_UNAVAILABLE' },
        );
      }

      await cacheSet(cacheKey, data, request.log, { ttl: 60 });

      return reply.send({ success: true, data });
    },
  );
  // -------------------------------------------------------------------------
  // POST /restaurants (admin — F032)
  // -------------------------------------------------------------------------

  app.post(
    '/restaurants',
    {
      schema: {
        body: CreateRestaurantBodySchema,
        tags: ['Catalog'],
        operationId: 'createRestaurant',
        summary: 'Create a restaurant',
        description:
          'Creates a new restaurant record. Admin endpoint — requires X-API-Key header. ' +
          'If chainSlug is omitted, a unique slug is auto-generated (independent-<slug>-<uuid4>). ' +
          'Returns HTTP 409 DUPLICATE_RESTAURANT if (chainSlug, countryCode) already exists.',
      },
    },
    async (request, reply) => {
      const body = request.body as CreateRestaurantBody;

      // Auto-generate chainSlug for independent restaurants
      const chainSlug = body.chainSlug ?? generateIndependentSlug(body.name);

      let created: {
        id: string;
        name: string;
        nameEs: string | null;
        chainSlug: string;
        website: string | null;
        logoUrl: string | null;
        countryCode: string;
        isActive: boolean;
        address: string | null;
        googleMapsUrl: string | null;
        latitude: unknown;
        longitude: unknown;
        createdAt: Date;
        updatedAt: Date;
      };

      try {
        created = await prisma.restaurant.create({
          data: {
            name: body.name,
            countryCode: body.countryCode,
            chainSlug,
            nameEs: body.nameEs ?? null,
            website: body.website ?? null,
            logoUrl: body.logoUrl ?? null,
            address: body.address ?? null,
            googleMapsUrl: body.googleMapsUrl ?? null,
            latitude: body.latitude ?? null,
            longitude: body.longitude ?? null,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw Object.assign(
            new Error('Restaurant already exists for this chain and country'),
            { code: 'DUPLICATE_RESTAURANT' },
          );
        }
        throw Object.assign(
          new Error('Database query failed'),
          { code: 'DB_UNAVAILABLE' },
        );
      }

      const data = {
        id: created.id,
        name: created.name,
        nameEs: created.nameEs,
        chainSlug: created.chainSlug,
        countryCode: created.countryCode,
        isActive: created.isActive,
        website: created.website,
        logoUrl: created.logoUrl,
        address: created.address,
        googleMapsUrl: created.googleMapsUrl,
        latitude: created.latitude != null
          ? (created.latitude as Prisma.Decimal).toNumber()
          : null,
        longitude: created.longitude != null
          ? (created.longitude as Prisma.Decimal).toNumber()
          : null,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };

      return reply.status(201).send({ success: true, data });
    },
  );
};

// Wrap with fastify-plugin so the routes are registered on the root scope,
// allowing the root-level error handler to apply to catalog route errors.
export const catalogRoutes = fastifyPlugin(catalogRoutesPlugin);
