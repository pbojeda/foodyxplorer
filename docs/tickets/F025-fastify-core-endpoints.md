# F025: Fastify Routes — Core Endpoints

**Feature:** F025 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F025-fastify-core-endpoints
**Created:** 2026-03-19 | **Dependencies:** E001 (schema), E002 (data ingested), E003 (estimation engine)

---

## Spec

### Description

F025 adds four read-only public-facing endpoints that serve as the consumption surface for the Telegram bot (F027-F028) and future API clients. All four endpoints are list/search/browse operations over existing data. No new DB tables or columns are introduced. The existing Prisma client, Kysely singleton, Redis cache helper, and error handler are reused.

These endpoints complement `GET /estimate` (the main nutritional query) by allowing consumers to browse the catalog of restaurants, chains, and dishes before querying for nutritional data.

### Architecture Decisions

1. **Pagination: offset-based (page/pageSize).** Bot use case is paginated menus (page 1, page 2, …), not infinite scroll. Offset pagination is simpler. Page size default: 20, max: 100. Current data volumes (~900 dishes, 7 chains) stay well under 3s.

2. **`GET /chains` is a dedicated lightweight endpoint.** The bot needs a fast chain-list for its selection menus without full restaurant payload. Returns one entry per `chainSlug` with aggregated `dishCount`. Not paginated — chain count is bounded (~20 max).

3. **Search uses `pg_trgm` trigram similarity, not FTS.** FTS is already used by the Estimation Engine for strict nutritional lookup. For browsing, users type partial names and expect typo-tolerant matching. `pg_trgm` with `similarity()` threshold ≥ 0.15 is better suited. Requires **new GIN indexes** on `dishes.name` and `dishes.name_es` (see Data Model Changes).

4. **Prisma for simple queries, Kysely for trigram search.** List/browse queries use Prisma `findMany` (no pgvector, no 3+ joins). Trigram search queries use Kysely raw SQL (requires `similarity()` function). Plugin options: `{ prisma, db }` — new pattern (existing routes use one or the other, never both).

5. **Cache TTL: 60s for all four endpoints.** Restaurant lists and dish counts change only on ingestion. Fail-open (same pattern as `/estimate`). Cache keys use `fxp:` prefix convention via `buildKey()`.

6. **Response envelope: `{ success: true, data: ... }`.** Paginated endpoints: `data: { items: [...], pagination: { page, pageSize, totalItems, totalPages } }`. Flat GET /chains: `data: [...]`.

7. **No auth in Phase 1.** Consistent with existing endpoints. API key auth added in F026.

8. **Decimal conversion.** Prisma returns `portionGrams` and `priceEur` as `Prisma.Decimal` objects. A `mapDishRow()` helper converts Decimal → number (via `.toNumber()`) for JSON-serializable responses.

9. **Plugin registration in `app.ts`.** New line: `await app.register(catalogRoutes, { prisma: prismaClient, db: getKysely() })`. First route to receive both Prisma and Kysely.

### API Changes

All endpoints registered in a single plugin file: `packages/api/src/routes/catalog.ts`.

#### `GET /restaurants`

**Tag:** Catalog | **OperationId:** `listRestaurants` | **Cache:** `fxp:restaurants:<params>` 60s

| Param | Type | Required | Description |
|---|---|---|---|
| `countryCode` | `^[A-Z]{2}$` | No | Filter by country |
| `chainSlug` | `^[a-z0-9-]+$` max 100 | No | Filter by chain |
| `isActive` | `"true"` or `"false"` | No | Filter by active status |
| `page` | int ≥ 1 | No | Default: 1 |
| `pageSize` | int 1–100 | No | Default: 20 |

**Response 200:** Paginated `RestaurantListItem[]` — id, name, nameEs, chainSlug, countryCode, isActive, logoUrl, website, dishCount.

**`dishCount`** via Prisma `_count: { select: { dishes: true } }`.

**Errors:** 400 `VALIDATION_ERROR`, 500 `DB_UNAVAILABLE`.

#### `GET /restaurants/:id/dishes`

**Tag:** Catalog | **OperationId:** `listRestaurantDishes` | **Cache:** `fxp:restaurant-dishes:<params>` 60s

| Param | Type | Required | Description |
|---|---|---|---|
| `id` (path) | UUID | Yes | Restaurant UUID |
| `search` | string max 255 | No | Trigram similarity search on `name` + `name_es` (threshold ≥ 0.15) |
| `availability` | DishAvailability enum | No | Filter |
| `page` | int ≥ 1 | No | Default: 1 |
| `pageSize` | int 1–100 | No | Default: 20 |

**Response 200:** Paginated `DishListItem[]` — id, name, nameEs, restaurantId, chainSlug, restaurantName, availability, portionGrams, priceEur.

**Query strategy:** No search → Prisma `findMany` with `orderBy: name ASC`. With search → Kysely trigram `similarity(name, $q) > 0.15 OR similarity(name_es, $q) > 0.15`, ordered by `GREATEST(similarity(name, $q), similarity(name_es, $q)) DESC`.

**Errors:** 400 `VALIDATION_ERROR`, 404 `NOT_FOUND` (restaurant does not exist), 500 `DB_UNAVAILABLE`.

#### `GET /dishes/search`

**Tag:** Catalog | **OperationId:** `searchDishes` | **Cache:** `fxp:dishes-search:<params>` 60s

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string min 1, max 255 | **Yes** | Trigram similarity search |
| `chainSlug` | `^[a-z0-9-]+$` max 100 | No | Scope to chain |
| `restaurantId` | UUID | No | Scope to restaurant (precedence over chainSlug) |
| `availability` | DishAvailability enum | No | Filter |
| `page` | int ≥ 1 | No | Default: 1 |
| `pageSize` | int 1–100 | No | Default: 20 |

**Response 200:** Paginated `DishListItem[]`. Zero results → 200 with `items: []`, `totalItems: 0` (never 404).

**Query strategy:** Always Kysely (trigram requires raw SQL). Join `dishes` + `restaurants` for `chainSlug` and `restaurantName`.

**Errors:** 400 `VALIDATION_ERROR`, 500 `DB_UNAVAILABLE`.

#### `GET /chains`

**Tag:** Catalog | **OperationId:** `listChains` | **Cache:** `fxp:chains:<params>` 60s

| Param | Type | Required | Description |
|---|---|---|---|
| `countryCode` | `^[A-Z]{2}$` | No | Filter by country |
| `isActive` | `"true"` or `"false"` | No | Filter |

**Response 200:** Flat `ChainListItem[]` (not paginated) — chainSlug, name, nameEs, countryCode, dishCount, isActive.

**Query strategy:** Prisma `findMany` on restaurants with `include: { _count: { select: { dishes: true } } }`, then group in JS by `chainSlug` (summing dishCount across restaurants with same slug). Max ~20 rows — no pagination needed.

**Errors:** 400 `VALIDATION_ERROR`, 500 `DB_UNAVAILABLE`.

### Data Model Changes

**No new tables or columns.** One new migration required:

```sql
-- F025: GIN trigram indexes for dish search
-- NOT CONCURRENTLY: Prisma migrations run inside transactions (incompatible with CONCURRENTLY).
-- Acceptable for current data volume (~900 dishes).
CREATE INDEX IF NOT EXISTS "dishes_name_trgm_idx"
  ON "dishes" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "dishes_name_es_trgm_idx"
  ON "dishes" USING gin ("name_es" gin_trgm_ops);
```

Verify `pg_trgm` extension already exists (created in F024 migration).

### New Zod Schemas — `packages/shared/src/schemas/catalog.ts`

```
BooleanStringSchema (reusable helper)
  z.enum(['true', 'false']).transform(v => v === 'true')
  // Avoids z.coerce.boolean() bug where Boolean("false") === true

CatalogPaginationSchema
  page:      z.coerce.number().int().min(1).default(1)
  pageSize:  z.coerce.number().int().min(1).max(100).default(20)

RestaurantListItemSchema
  id:          z.string().uuid()
  name:        z.string()
  nameEs:      z.string().nullable()
  chainSlug:   z.string()
  countryCode: z.string().length(2)
  isActive:    z.boolean()
  logoUrl:     z.string().nullable()
  website:     z.string().nullable()
  dishCount:   z.number().int().nonnegative()

RestaurantListQuerySchema
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).optional()
  chainSlug:   z.string().regex(/^[a-z0-9-]+$/).max(100).optional()
  isActive:    BooleanStringSchema.optional()
  + CatalogPaginationSchema fields (merged)

RestaurantDishListQuerySchema
  search:       z.string().trim().max(255).optional()
  availability: DishAvailabilitySchema.optional()
  + CatalogPaginationSchema fields (merged)

RestaurantDishParamsSchema
  id: z.string().uuid()

DishListItemSchema
  id:             z.string().uuid()
  name:           z.string()
  nameEs:         z.string().nullable()
  restaurantId:   z.string().uuid()
  chainSlug:      z.string()
  restaurantName: z.string()
  availability:   DishAvailabilitySchema
  portionGrams:   z.number().positive().nullable()
  priceEur:       z.number().nonnegative().nullable()
  // Nutrients excluded — consumer uses GET /estimate

DishSearchQuerySchema
  q:             z.string().trim().min(1).max(255)
  chainSlug:     z.string().regex(/^[a-z0-9-]+$/).max(100).optional()
  restaurantId:  z.string().uuid().optional()
  availability:  DishAvailabilitySchema.optional()
  + CatalogPaginationSchema fields (merged)

ChainListItemSchema
  chainSlug:   z.string()
  name:        z.string()
  nameEs:      z.string().nullable()
  countryCode: z.string().length(2)
  dishCount:   z.number().int().nonnegative()
  isActive:    z.boolean()

ChainListQuerySchema
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).optional()
  isActive:    BooleanStringSchema.optional()

PaginationMetaSchema
  page:       z.number().int()
  pageSize:   z.number().int()
  totalItems: z.number().int()
  totalPages: z.number().int()
```

### Edge Cases & Error Handling

1. **Restaurant exists, zero dishes.** Returns 200 with `items: []`, `totalItems: 0`, `totalPages: 0`. Not 404.
2. **Search with no results.** Returns 200 with `items: []`. Never 404 (consistent with `GET /estimate` miss semantics).
3. **`page` beyond `totalPages`.** Returns 200 with `items: []`. No error.
4. **`chainSlug` AND `restaurantId` both in `GET /dishes/search`.** `restaurantId` takes precedence.
5. **Same `chainSlug`, multiple countries.** Without `countryCode` filter, `GET /chains` returns separate entries per country.
6. **Trigram search on 1-2 char strings.** Low-quality results expected — acceptable for Phase 1, no special handling.
7. **Redis unavailable.** Cache fail-open: query proceeds to DB.
8. **`isActive` omitted.** Returns both active and inactive. Intentional — bot may show discontinued chains for historical queries.
9. **Prisma Decimal fields.** `portionGrams` and `priceEur` returned as `Prisma.Decimal`. `mapDishRow()` helper converts to `number | null` via `.toNumber()`.

---

## Implementation Plan

### Existing Code to Reuse

- `packages/api/src/lib/cache.ts` — `buildKey`, `cacheGet`, `cacheSet` (TTL 60s via `options.ttl`)
- `packages/api/src/errors/errorHandler.ts` — `NOT_FOUND` and `DB_UNAVAILABLE` error codes already handled; throw `Object.assign(new Error(...), { code: 'NOT_FOUND' })` pattern
- `packages/api/src/app.ts` — `BuildAppOptions`, `buildApp` factory, plugin registration pattern
- `packages/api/src/lib/kysely.ts` — `getKysely()` singleton
- `packages/api/src/lib/prisma.ts` — `prisma` singleton
- `packages/shared/src/schemas/enums.ts` — `DishAvailabilitySchema` (reuse in query schemas)
- `packages/shared/src/schemas/restaurant.ts` — existing `RestaurantSchema` fields serve as reference; do NOT reuse it directly — the new `RestaurantListItemSchema` adds `dishCount` and omits `createdAt/updatedAt`
- `packages/shared/src/schemas/dish.ts` — existing `DishSchema` fields as reference; `DishListItemSchema` is a new projection (no `aliases`, `confidenceLevel`, `estimationMethod`, `sourceId`; adds `restaurantName`, `chainSlug`)
- Route pattern from `packages/api/src/routes/estimate.ts` (Kysely, cache, `fastify-plugin` wrap) and `packages/api/src/routes/quality.ts` (Prisma, try/catch `DB_UNAVAILABLE` throw)
- Test pattern from `packages/api/src/__tests__/f020.estimate.route.test.ts` — `vi.hoisted()` mocks for Redis, Prisma, Kysely; `buildApp().inject()` without real DB

---

### Files to Create

1. **`packages/shared/src/schemas/catalog.ts`**
   All new Zod schemas for the catalog surface: `BooleanStringSchema`, `CatalogPaginationSchema`, `RestaurantListItemSchema`, `RestaurantListQuerySchema`, `RestaurantDishParamsSchema`, `RestaurantDishListQuerySchema`, `DishListItemSchema`, `DishSearchQuerySchema`, `ChainListItemSchema`, `ChainListQuerySchema`, `PaginationMetaSchema`. Exports TypeScript types inferred from each schema.

2. **`packages/api/prisma/migrations/20260319140000_trgm_indexes_f025/migration.sql`**
   GIN trigram index migration. Uses `--create-only` workflow. Verifies `pg_trgm` exists (already created in `init-db.sql` and test DB setup), then creates two GIN indexes (NOT `CONCURRENTLY` — Prisma migrations run inside a transaction, and CONCURRENTLY is incompatible with transactions; acceptable for current data volume ~900 dishes).

3. **`packages/api/src/routes/catalog.ts`**
   Single Fastify plugin file registering all four catalog endpoints. Contains `CatalogPluginOptions` interface (`{ prisma, db }`), the `mapDishRow()` helper, and all four route handlers with Prisma/Kysely queries, cache logic, and error handling.

4. **`packages/api/src/__tests__/f025.catalog.route.test.ts`**
   Route-level unit tests for all four endpoints. Uses `buildApp().inject()`. Mocks Redis, Prisma, Kysely via `vi.mock`. Covers: validation errors, 200 happy path, 404 for unknown restaurant, cache hit/miss, Redis fail-open, DB error → 500.

---

### Files to Modify

1. **`packages/shared/src/index.ts`**
   Add `export * from './schemas/catalog';` after the existing `estimate` export line.

2. **`packages/api/src/app.ts`**
   - Add import: `import { catalogRoutes } from './routes/catalog.js';`
   - Add registration after the `estimateRoutes` line:
     `await app.register(catalogRoutes, { prisma: prismaClient, db: getKysely() });`

3. **`docs/specs/api-spec.yaml`**
   Add the four new paths (`/restaurants`, `/restaurants/{id}/dishes`, `/dishes/search`, `/chains`) with their query parameters, response schemas (`RestaurantListItem`, `DishListItem`, `ChainListItem`, `PaginationMeta`), and the `Catalog` tag. Add the new schemas to the `components/schemas` section.

---

### Implementation Order

1. **`packages/shared/src/schemas/catalog.ts`** — Domain/Shared layer. All Zod schemas must exist before the route or tests can import them.

2. **`packages/shared/src/index.ts`** — Barrel export. Enables `@foodxplorer/shared` imports in the route and tests.

3. **`packages/api/prisma/migrations/20260319140000_trgm_indexes_f025/migration.sql`** — Infrastructure layer. Run `prisma migrate dev --create-only --name trgm_indexes_f025`, then replace the generated (empty) SQL with the GIN index statements. Deploy with `prisma migrate deploy`.

4. **`packages/api/src/routes/catalog.ts`** — Presentation layer. Implement `mapDishRow()`, `CatalogPluginOptions`, and all four route handlers. The route file is the core deliverable.

5. **`packages/api/src/app.ts`** — Presentation layer wiring. Register the new plugin.

6. **`packages/api/src/__tests__/f025.catalog.route.test.ts`** — Tests. Write failing tests first (TDD), then verify they pass after Step 4–5.

7. **`docs/specs/api-spec.yaml`** — Documentation. Update after implementation is confirmed working.

---

### Testing Strategy

**Test file:** `packages/api/src/__tests__/f025.catalog.route.test.ts`

**Pattern:** Same as `f020.estimate.route.test.ts` — no real DB. All external dependencies mocked at module level with `vi.hoisted()`.

**Mocking strategy:**
- `vi.mock('../lib/redis.js', ...)` — mock `redis.get` and `redis.set` as `vi.fn()`
- `vi.mock('../lib/prisma.js', ...)` — mock `prisma` as a shaped object with `vi.fn()` methods for `restaurant.findMany`, `restaurant.count`, `restaurant.findUnique`, `dish.findMany`, `dish.count`
- `vi.mock('../lib/kysely.js', ...)` — mock `getKysely()` returning a shaped Kysely stub with `selectFrom`, `where`, `orderBy`, `limit`, `offset`, `execute` as chained `vi.fn()` returning `[]` by default (same minimal executor pattern as `f020`)
- `buildApp({ prisma: mockPrisma })` — pass the mock Prisma via `BuildAppOptions`; Kysely is wired via the module mock

**Key test scenarios:**

`GET /restaurants`:
- Returns 200 with `{ success: true, data: { items: [...], pagination: {...} } }` when Prisma returns mock restaurants with `_count.dishes`
- Returns 400 VALIDATION_ERROR when `isActive=yes` (not `true`/`false`)
- Returns 400 VALIDATION_ERROR when `countryCode=esp` (not 2-char uppercase)
- Returns 400 VALIDATION_ERROR when `page=0`
- `isActive=false` is NOT coerced to `true` — mock asserts Prisma `where.isActive === false`
- Cache hit: second call (mocked Redis `get` returns JSON) skips Prisma call
- Redis fail-open: `redis.get` rejects → Prisma still called, 200 returned

`GET /restaurants/:id/dishes`:
- Returns 200 with paginated dishes (no search) — Prisma path
- Returns 200 with trigram results (search present) — Kysely path
- Returns 404 NOT_FOUND when `prisma.restaurant.findUnique` returns `null`
- Returns 400 VALIDATION_ERROR when `id` is not a UUID
- Returns 400 VALIDATION_ERROR when `pageSize=0`
- `portionGrams` and `priceEur` in response are plain `number | null` (not Decimal objects) — `mapDishRow()` conversion verified

`GET /dishes/search`:
- Returns 200 with `items: []` and `totalItems: 0` when Kysely returns empty array (never 404)
- Returns 400 VALIDATION_ERROR when `q` is missing
- Returns 400 VALIDATION_ERROR when `q` is empty string after trim
- `restaurantId` takes precedence over `chainSlug` — verify Kysely mock called with correct WHERE clause shape
- Cache hit scenario

`GET /chains`:
- Returns 200 flat array with `dishCount` aggregated across restaurants with same `chainSlug`
- Returns 400 VALIDATION_ERROR when `countryCode=es` (lowercase)
- `isActive=false` filter works correctly (not coerced to true)
- DB error → 500 DB_UNAVAILABLE

**Response schema validation:** At least one test per endpoint calls `ChainListItemSchema.array().safeParse()` / `RestaurantListItemSchema.safeParse()` on the response body to confirm serialization is correct.

---

### Key Patterns

**Plugin structure** — follow `estimate.ts` exactly:
```
const catalogRoutesPlugin: FastifyPluginAsync<CatalogPluginOptions> = async (app, opts) => { ... }
export const catalogRoutes = fastifyPlugin(catalogRoutesPlugin);
```

**Boolean query param** — use `BooleanStringSchema` (`z.enum(['true','false']).transform(v => v === 'true')`). Never `z.coerce.boolean()`. Validated in tests with `isActive=false`.

**Nonnegative convention** — use `.nonnegative()` not `.nonneg()` everywhere.

**Two mappers for Prisma vs Kysely return shapes:**

Prisma returns camelCase with nested relations; Kysely returns snake_case flat rows. Both must produce the same `DishListItem` shape.

```typescript
// Prisma path (no-search): nested restaurant relation, camelCase fields
function mapPrismaDishRow(row: PrismaDishWithRestaurant): DishListItem {
  return {
    id: row.id,
    name: row.name,
    nameEs: row.nameEs,
    restaurantId: row.restaurantId,
    chainSlug: row.restaurant.chainSlug,
    restaurantName: row.restaurant.name,
    availability: row.availability,
    portionGrams: row.portionGrams ? row.portionGrams.toNumber() : null,
    priceEur: row.priceEur ? row.priceEur.toNumber() : null,
  };
}

// Kysely path (trigram search): flat snake_case columns
function mapKyselyDishRow(row: KyselyDishRow): DishListItem {
  return {
    id: row.id,
    name: row.name,
    nameEs: row.name_es,
    restaurantId: row.restaurant_id,
    chainSlug: row.chain_slug,
    restaurantName: row.restaurant_name,
    availability: row.availability,
    portionGrams: row.portion_grams ? Number(row.portion_grams) : null,
    priceEur: row.price_eur ? Number(row.price_eur) : null,
  };
}
```
Import `Prisma` namespace from `@prisma/client` for the Prisma Decimal type. Kysely Decimal columns arrive as `string` (pg driver behavior) — use `Number()` conversion.

**Cache key helper** — use a stable serializer for cache-key stability (JSON.stringify does NOT sort keys by default):
```typescript
function stableKey(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
```

**Cache keys** (60s TTL via `{ ttl: 60 }` in `cacheSet`):
- `GET /restaurants`: `buildKey('restaurants', stableKey(parsedQuery))`
- `GET /restaurants/:id/dishes`: `buildKey('restaurant-dishes', JSON.stringify({ id, ...sortedQuery }))`
- `GET /dishes/search`: `buildKey('dishes-search', JSON.stringify(sortedQuery))`
- `GET /chains`: `buildKey('chains', JSON.stringify(sortedQuery))`

Cache key serialization: use `JSON.stringify` on the Zod-parsed (coerced) query object. Because defaults are applied by Zod before this point, `page=1&pageSize=20` and an omitted pagination produce the same key.

**GET /restaurants/:id/dishes — restaurant existence check** — use `prisma.restaurant.findUnique({ where: { id } })` before the dish query. On `null`, throw `Object.assign(new Error('Restaurant not found'), { code: 'NOT_FOUND', statusCode: 404 })`. The existing `errorHandler` already maps `NOT_FOUND` code to 404.

**GET /restaurants/:id/dishes — Prisma path (no search)** — include `availability` filter:
```typescript
prisma.dish.findMany({
  where: { restaurantId: id, ...(availability && { availability }) },
  include: { restaurant: { select: { name: true, chainSlug: true } } },
  orderBy: { name: 'asc' },
  skip: (page - 1) * pageSize,
  take: pageSize,
})
```
Count query: `prisma.dish.count({ where: { restaurantId: id, ...(availability && { availability }) } })`.

**DB error pattern** — wrap Prisma and Kysely calls in try/catch, re-throw with `code: 'DB_UNAVAILABLE'`:
```typescript
try {
  // ...prisma or kysely call
} catch {
  throw Object.assign(new Error('Database query failed'), { code: 'DB_UNAVAILABLE' });
}
```

**GET /restaurants — Prisma query with pagination count:**
```typescript
const where = {
  ...(countryCode && { countryCode }),
  ...(chainSlug && { chainSlug }),
  ...(isActive !== undefined && { isActive }),
};
const [items, totalItems] = await Promise.all([
  prisma.restaurant.findMany({
    where,
    include: { _count: { select: { dishes: true } } },
    orderBy: { name: 'asc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  }),
  prisma.restaurant.count({ where }),
]);
```
Map each item: `{ ...rest, dishCount: _count.dishes }` (destructure `_count` out).

**GET /chains aggregation** — Prisma `findMany` on Restaurant model:
```typescript
prisma.restaurant.findMany({
  where: { ...(countryCode && { countryCode }), ...(isActive !== undefined && { isActive }) },
  include: { _count: { select: { dishes: true } } },
})
```
Then group in JS using a `Map<string, ChainListItem>` keyed on `chainSlug`. For each restaurant, if the slug is already in the map, add `_count.dishes` to the existing `dishCount`; otherwise insert a new entry. **Name resolution:** use `name` and `nameEs` from the first restaurant encountered per `chainSlug` bucket (current data has exactly 1 restaurant per chain per country, so no ambiguity). **`isActive` aggregation:** a chain is `isActive: true` if ANY restaurant in the group is active.

**`totalPages` calculation** — all paginated endpoints: `totalPages: Math.ceil(totalItems / pageSize)`. When `totalItems === 0`, `totalPages` is `0`.

**GET /restaurants/:id/dishes — Kysely trigram query** — when `search` is present, use `sql` tagged template from Kysely for raw fragments within a structured query:
```typescript
db.selectFrom('dishes as d')
  .innerJoin('restaurants as r', 'r.id', 'd.restaurant_id')
  .select([
    'd.id', 'd.name', 'd.name_es', 'd.restaurant_id',
    'd.availability', 'd.portion_grams', 'd.price_eur',
    'r.name as restaurant_name', 'r.chain_slug as chain_slug',
  ])
  .where(sql`(similarity(d.name, ${search}) > 0.15 OR similarity(d.name_es, ${search}) > 0.15)`)
  .where('d.restaurant_id', '=', restaurantId)
  .orderBy(sql`GREATEST(similarity(d.name, ${search}), similarity(d.name_es, ${search})) DESC`)
  .limit(pageSize)
  .offset((page - 1) * pageSize)
  .execute()
```
Count query is a separate Kysely query using `db.selectFrom('dishes as d').innerJoin(...).select(db.fn.countAll().as('count')).where(/* same trigram + filter clauses */).executeTakeFirstOrThrow()` — then cast `Number(result.count)` for `totalItems`. Same pattern for `GET /dishes/search`.

**GET /dishes/search — Kysely query** — same trigram pattern but scoped to restaurant or chain:
```typescript
let query = db.selectFrom('dishes as d')
  .innerJoin('restaurants as r', 'r.id', 'd.restaurant_id')
  // ... select fields
  .where(sql`(similarity(d.name, ${q}) > 0.15 OR similarity(d.name_es, ${q}) > 0.15)`)

if (restaurantId) {
  query = query.where('d.restaurant_id', '=', restaurantId);
} else if (chainSlug) {
  query = query.where('r.chain_slug', '=', chainSlug);
}
if (availability) {
  query = query.where('d.availability', '=', availability);
}
```
`restaurantId` takes precedence over `chainSlug` — apply only one, not both.

**Swagger tags** — use `tags: ['Catalog']` in each route's schema object, matching the spec's `operationId` values: `listRestaurants`, `listRestaurantDishes`, `searchDishes`, `listChains`.

**Migration timestamp** — next sequential ID after `20260317150000` (F019) is `20260319140000` (F025). Follow the `--create-only` → hand-edit → deploy workflow. Do NOT use `prisma migrate dev` directly.

**Gotcha — Prisma `_count` type** — the `include: { _count: { select: { dishes: true } } }` result adds `_count: { dishes: number }` to each restaurant object. TypeScript will infer this correctly. When mapping to `RestaurantListItem`, destructure as `const { _count, ...rest } = row` and set `dishCount: _count.dishes`.

**Gotcha — `sql` import for Kysely raw fragments** — import `sql` from `'kysely'`, not from `'@foodxplorer/shared'`. Use interpolation (`${param}`) for user-supplied values to ensure parameterized queries; never concatenate search strings directly into SQL.

**Gotcha — `CatalogPaginationSchema` field merging** — query schemas cannot use `z.merge()` directly with objects that have differing optional/required semantics. Use `z.object({ ...CatalogPaginationSchema.shape, ... })` spread to include pagination fields in each query schema rather than `.merge()`, which avoids type-level conflicts.

---

## Acceptance Criteria

- [x] `GET /restaurants` returns all 7 chains with correct `dishCount` values
- [x] `GET /restaurants/:id/dishes` returns paginated dish list with `chainSlug` and `restaurantName`
- [x] `GET /restaurants/:uuid-not-found/dishes` returns 404 `NOT_FOUND`
- [x] `GET /dishes/search?q=Big+Mac` returns at least one dish from McDonald's
- [x] `GET /dishes/search?q=Big+Mac&chainSlug=burger-king-es` returns zero results
- [x] `GET /chains` returns 7 entries (current data), each with `dishCount > 0`
- [x] All endpoints cache responses; second call within 60s served from cache
- [x] All endpoints return 400 `VALIDATION_ERROR` for invalid params
- [x] `?isActive=false` correctly filters to inactive restaurants (not coerced to true)
- [x] All four endpoints appear in Swagger UI under "Catalog" tag
- [x] Response time < 3s for all endpoints with current data volume
- [x] GIN trigram indexes created on `dishes.name` and `dishes.name_es`
- [x] Unit tests for new functionality (67 tests: 34 route + 33 edge cases)
- [x] All tests pass (67/67)
- [x] Build succeeds (no new errors — pre-existing in image-url/pdf-url)
- [x] Specs updated (`api-spec.yaml`, shared schemas)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (67/67)
- [x] E2E tests updated (if applicable) — N/A, unit tests only
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, spec reviewed (7 issues found, all fixed)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD (34 tests)
- [x] Step 4: `production-code-validator` executed, quality gates pass (0 issues)
- [x] Step 5: `code-review-specialist` executed (1 IMPORTANT fixed, 1 cleanup)
- [x] Step 5: `qa-engineer` executed — 33 edge-case tests added, QA VERIFIED
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-19 | Spec created | spec-creator + self-review: 2 CRITICAL (boolean coercion, .nonneg()), 3 IMPORTANT (trigram indexes, Decimal conversion, plugin pattern), 2 SUGGESTION (groupBy strategy, description field). All fixed |
| 2026-03-19 | Branch + ticket | feature/F025-fastify-core-endpoints from develop |
| 2026-03-19 | Plan created | backend-planner + self-review round 1 (3 fixes: CONCURRENTLY, count query, availability filter) |
| 2026-03-19 | Plan reviewed | Self-review round 2: 2C+1I+1S — snake_case vs camelCase mappers, selectAll→explicit columns, restaurants count query, stableKey helper. All fixed |
| 2026-03-19 | Plan reviewed | Gemini review: 1C (already fixed), 2I (1 real: chains name resolution, 1 false positive), 2S (1 false positive, 1 added: totalPages). 2 issues addressed |
| 2026-03-19 | Implementation | backend-developer: 4 files created, 3 modified. 34 tests, all passing. TDD cycle complete |
| 2026-03-19 | Finalize | production-code-validator: 0 issues. TypeScript clean, ESLint clean, 34/34 tests pass |
| 2026-03-19 | Code review | code-review-specialist: 1 IMPORTANT (chains grouping key chainSlug→chainSlug:countryCode), 1 cleanup (dead NOT_FOUND guard). Both fixed |
| 2026-03-19 | QA | qa-engineer: 8 coverage gaps found, 33 edge-case tests added. QA VERIFIED. Total: 67 tests |
| 2026-03-19 | Complete | Step 6: ticket closed, squash-merged to develop, branch deleted |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 16/16, DoD: 7/7, Workflow: 0-5/6 |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: catalog routes, catalog schemas, migrations count (5→6) |
| 4. Update decisions.md | [x] | N/A — no new ADRs needed |
| 5. Commit documentation | [x] | Commit: 98523c3 |
| 6. Verify clean working tree | [x] | `git status`: clean (only untracked initialDoc/ — preexisting, not F025) |

---

*Ticket created: 2026-03-19*
