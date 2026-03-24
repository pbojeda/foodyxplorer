# F032: Restaurant Resolution + Creation

**Feature:** F032 | **Type:** Fullstack-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F032-restaurant-resolution-creation
**Created:** 2026-03-24 | **Dependencies:** None

---

## Spec

### Description

F032 extends the restaurant catalog in three areas:

1. **Schema migration** — adds four new columns to the `restaurants` table (`address`, `googleMapsUrl`, `latitude`, `longitude`). `chainSlug` stays required (NOT NULL) but independent restaurants receive a server-generated slug (`independent-<name-slug>-<uuid-short>`) so the `@@unique([chainSlug, countryCode])` constraint continues to work without structural changes to the index.

2. **Restaurant search** — adds `?q=` to `GET /restaurants` for trigram similarity search on `restaurants.name` (pg_trgm, threshold >= 0.15). Implemented via Kysely (same pattern as the existing dish search on `GET /restaurants/:id/dishes`). Combinable with all existing filters. Results ordered by similarity score descending when `q` is present.

3. **Restaurant creation** — new `POST /restaurants` admin endpoint. Accepts `name`, `countryCode`, optional `chainSlug` (chain restaurants), and optional location fields. Returns the created record at HTTP 201. A "Telegram Upload" DataSource (UUID `00000000-0000-0000-0000-000000000099`) is seeded in this migration for use by the bot's subsequent dish-upload flow.

Bot integration (Redis conversation state, `/restaurante` command, creation flow with inline keyboard) is the bot-side component of this feature.

### Architecture Decisions

- `chainSlug` stays NOT NULL. For independent restaurants the server auto-generates `independent-<name-slugified>-<uuid-short>` (first 4 chars of a fresh `crypto.randomUUID()` fragment). The `@@unique([chainSlug, countryCode])` DB constraint requires no migration changes beyond adding the new columns.
- Google Maps short-link resolution is deferred to Phase 2 (ADR-009 decision 8). Phase 1 callers provide the full URL or omit the field.
- Redis conversation state key for the bot: `bot:state:{chatId}`, TTL 2h (ADR-009 decision 4).
- The fixed "Telegram Upload" DataSource UUID (`...0099`) is seeded once in `seed.ts`; the bot hardcodes this UUID for all uploads made in the creation flow.

### API Changes

**Modified: `GET /restaurants`**
- New optional query param `q` (string, 1-100 chars): trigram similarity search on `restaurants.name` using pg_trgm, threshold >= 0.15.
- When `q` is provided, Kysely handles the query (not Prisma); all other filters still apply. Results ordered by similarity score descending.
- When `q` is omitted: behaviour unchanged (Prisma, name ASC).

**New: `POST /restaurants`** (admin — `X-API-Key: <ADMIN_API_KEY>`)
- Request body: `name` (required), `countryCode` (required), `chainSlug` (optional), `nameEs`, `website`, `logoUrl`, `address`, `latitude`, `longitude`, `googleMapsUrl`.
- Response: HTTP 201 with the created restaurant record (includes server-generated `id`, `chainSlug`, `createdAt`).
- Error responses: 400 validation, 401 missing key, 409 `DUPLICATE_RESTAURANT` (chain + country already exists), 500 DB failure.

**New error code:** `DUPLICATE_RESTAURANT` (HTTP 409) — `chainSlug` + `countryCode` unique constraint violation.

### Data Model Changes

New columns on `restaurants` table:

| Column | Prisma field | Type | Nullable | Notes |
|---|---|---|---|---|
| `address` | `address` | `String?` `@db.VarChar(500)` | YES | Free-text street address |
| `google_maps_url` | `googleMapsUrl` | `String?` `@map("google_maps_url") @db.Text` | YES | Full Google Maps URL |
| `latitude` | `latitude` | `Decimal?` `@db.Decimal(10,7)` | YES | GPS decimal degrees |
| `longitude` | `longitude` | `Decimal?` `@db.Decimal(10,7)` | YES | GPS decimal degrees |

No changes to existing columns or constraints. No change to `@@unique([chainSlug, countryCode])`.

**New Prisma seed row:** `DataSource` with `id = '00000000-0000-0000-0000-000000000099'`, `name = 'Telegram Upload'`, `type = 'user'`, `url = null`.

### Zod Schema Changes

- `RestaurantSchema` — add optional fields: `address`, `googleMapsUrl`, `latitude`, `longitude`
- `RestaurantListItemSchema` — add `address` (nullable) for display
- `RestaurantListQuerySchema` — add `q: z.string().min(1).max(100).optional()`
- New `CreateRestaurantBodySchema` — required: `name` (1-255), `countryCode` (`^[A-Z]{2}$`); optional: `nameEs`, `chainSlug`, `website`, `logoUrl`, `address`, `latitude`, `longitude`, `googleMapsUrl`

### Edge Cases & Error Handling

| Case | Behaviour |
|---|---|
| `POST /restaurants` with existing (chainSlug, countryCode) | HTTP 409 `DUPLICATE_RESTAURANT` |
| `POST /restaurants` without `chainSlug` | Server generates `independent-<slug>-<uuid-4>` |
| Two independent restaurants with same name + country | Both allowed — UUID fragment makes slugs unique |
| `GET /restaurants?q=` (empty string) | HTTP 400 `VALIDATION_ERROR` (minLength: 1) |
| `GET /restaurants?q=...` with no trigram matches | HTTP 200 with empty `items` array |
| `latitude` provided without `longitude` (or vice versa) | Both fields are independently nullable; partial GPS is allowed |
| `chainSlug` with uppercase or spaces in POST body | HTTP 400 `VALIDATION_ERROR` (pattern: `^[a-z0-9-]+$`) |
| `POST /restaurants` without admin key | HTTP 401 `UNAUTHORIZED` |
| DB down during POST | HTTP 500 `DB_UNAVAILABLE` |

---

## Implementation Plan

### Existing Code to Reuse

- **Prisma client singleton** — `packages/api/src/lib/prisma.ts` (auto-selects test DB)
- **Kysely singleton** — `packages/api/src/lib/kysely.ts` (`getKysely()`, `destroyKysely()`)
- **Cache helpers** — `packages/api/src/lib/cache.ts` (`buildKey`, `cacheGet`, `cacheSet`)
- **Error handler** — `packages/api/src/errors/errorHandler.ts` (`mapError`, `registerErrorHandler`) — add `DUPLICATE_RESTAURANT` case
- **Admin auth** — `packages/api/src/plugins/auth.ts` + `adminPrefixes.ts` (`isAdminRoute`, `ADMIN_PREFIXES`)
- **`adminAuth.ts`** — `validateAdminKey()` pure function (already used by `/ingest/*`, `/analytics/*`)
- **Catalog route plugin** — `packages/api/src/routes/catalog.ts` — extend in place (dual Prisma/Kysely pattern, `stableKey` helper, `CatalogPluginOptions`)
- **`RestaurantListQuerySchema`** in `packages/shared/src/schemas/catalog.ts` — add `q` field
- **`RestaurantListItemSchema`** in `packages/shared/src/schemas/catalog.ts` — add `address` field
- **`RestaurantSchema`** in `packages/shared/src/schemas/restaurant.ts` — add 4 new optional fields
- **`CatalogPaginationSchema`** — reuse unchanged
- **`BooleanStringSchema`** — reuse unchanged
- **Seed phase pattern** — existing `seedPhase3`–`seedPhase7` in `packages/api/prisma/seed.ts` as structural reference
- **`CHAIN_SEED_IDS`** pattern from `packages/api/src/config/chains/chain-seed-ids.ts` — NOT reused directly (Telegram Upload is a global DataSource, not a chain)
- **`stableKey()`** helper in `catalog.ts` — reuse for new cache keys
- **Kysely trigram pattern** from `GET /dishes/search` in `catalog.ts` — direct template for `GET /restaurants?q=`
- **Fixture UUID pattern** `fd000000-00XX-4000-a000-000000000YYY` — reuse in test files

---

### Files to Create

1. **`packages/api/prisma/migrations/20260324170000_restaurants_location_f032/migration.sql`**
   New migration: adds 4 columns to `restaurants` + triggers Prisma schema regeneration.

2. **`packages/api/src/__tests__/f032.catalog.route.test.ts`**
   Route tests for the modified `GET /restaurants?q=` and new `POST /restaurants`. Uses `buildApp().inject()`. Mocks Prisma, Kysely, Redis at module level following `f025.catalog.route.test.ts` pattern.

3. **`packages/api/src/__tests__/f032.catalog.edge-cases.test.ts`**
   Edge-case and schema unit tests for the new Zod schemas, slug auto-generation logic, and `mapError` with `DUPLICATE_RESTAURANT`.

4. **`packages/api/src/__tests__/seed.phase8.integration.test.ts`**
   Integration test confirming `seedPhase8` upserts the Telegram Upload DataSource with the correct UUID into the real test DB.

5. **`packages/api/src/utils/slugify.ts`**
   Exported `generateIndependentSlug(name: string): string` utility. Extracted for direct unit testing (TDD).

---

### Files to Modify

1. **`packages/api/prisma/schema.prisma`**
   Add 4 fields to the `Restaurant` model: `address`, `googleMapsUrl`, `latitude`, `longitude`.

2. **`packages/api/src/generated/kysely-types.ts`**
   After `prisma generate`, regenerate via `prisma-kysely` — the `Restaurant` type gains the 4 new columns. Developer runs `npm run generate -w @foodxplorer/api` (or equivalent) after migration.

3. **`packages/shared/src/schemas/restaurant.ts`**
   - Add `address`, `googleMapsUrl`, `latitude`, `longitude` as optional/nullable fields to `RestaurantSchema`.
   - Add new exported `CreateRestaurantBodySchema` (the admin POST body schema).

4. **`packages/shared/src/schemas/catalog.ts`**
   - Add `q: z.string().trim().min(1).max(100).optional()` to `RestaurantListQuerySchema`.
   - Add `address: z.string().nullable()` to `RestaurantListItemSchema`.

5. **`packages/shared/src/index.ts`**
   Export `CreateRestaurantBodySchema` and its inferred type (`CreateRestaurantBody`) — already covered by `export * from './schemas/restaurant'` if added there.

6. **`packages/api/src/routes/catalog.ts`**
   - Extend `GET /restaurants` handler: add trigram path when `q` is present (Kysely), keep Prisma path unchanged when `q` is absent.
   - Add a new `KyselyRestaurantRow` internal interface (snake_case fields matching the SELECT).
   - Add `mapKyselyRestaurantRow()` mapper function.
   - Add `POST /restaurants` handler (admin, `X-API-Key`).
   - Update `RestaurantListItem` mapping in both Prisma and Kysely paths to include `address`.

7. **`packages/api/src/errors/errorHandler.ts`**
   Add `DUPLICATE_RESTAURANT` error code handling: HTTP 409.

8. **`packages/api/src/plugins/adminPrefixes.ts`**
   Extend `isAdminRoute(url, method?)` to return `true` for `POST /restaurants`.

9. **`packages/api/src/plugins/auth.ts`**
   Pass `request.method` to `isAdminRoute(url, request.method)`.

10. **`packages/api/prisma/seed.ts`**
   Add `seedPhase8(client)` function exporting the Telegram Upload DataSource upsert. Call it from `main()` after Phase 7.

---

### Implementation Order

**Step 1 — Domain/Schema: Zod schemas in `packages/shared`**

1a. `packages/shared/src/schemas/restaurant.ts`
- Add to `RestaurantSchema`:
  ```
  address:       z.string().max(500).nullable().optional()
  googleMapsUrl: z.string().nullable().optional()
  latitude:      z.number().nullable().optional()
  longitude:     z.number().nullable().optional()
  ```
- Add `CreateRestaurantBodySchema` as a new named export:
  ```
  name:          z.string().min(1).max(255)
  countryCode:   z.string().length(2).regex(/^[A-Z]{2}$/)
  chainSlug:     z.string().regex(/^[a-z0-9-]+$/).max(100).optional()
  nameEs:        z.string().min(1).max(255).optional()
  website:       z.string().optional()
  logoUrl:       z.string().optional()
  address:       z.string().max(500).optional()
  latitude:      z.number().min(-90).max(90).optional()
  longitude:     z.number().min(-180).max(180).optional()
  googleMapsUrl: z.string().optional()
  ```
  Export `type CreateRestaurantBody = z.infer<typeof CreateRestaurantBodySchema>`.

1b. `packages/shared/src/schemas/catalog.ts`
- Add `address: z.string().nullable()` to `RestaurantListItemSchema`.
- Add `q: z.string().trim().min(1).max(100).optional()` to `RestaurantListQuerySchema`.

**Step 2 — Infrastructure: Prisma migration**

2a. `packages/api/prisma/schema.prisma` — add to `Restaurant` model (after `isActive`):
```
address       String?   @db.VarChar(500)
googleMapsUrl String?   @map("google_maps_url") @db.Text
latitude      Decimal?  @db.Decimal(10, 7)
longitude     Decimal?  @db.Decimal(10, 7)
```

2b. Create migration file `packages/api/prisma/migrations/20260324170000_restaurants_location_f032/migration.sql`:
```sql
-- F032: Add location fields to restaurants
ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "address"          VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "google_maps_url"  TEXT,
  ADD COLUMN IF NOT EXISTS "latitude"         DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "longitude"        DECIMAL(10,7);
```
No trigram indexes needed for `restaurants.name` at this time — the trigram search uses `WHERE similarity(r.name, $1) > 0.15` directly (no session-level threshold setting). Restaurant count is small (~30 rows) so a sequential scan is fine. Developer may optionally add a GIN index following the `dishes_name_trgm_idx` pattern if performance testing reveals a need.

2c. Run `prisma migrate deploy` (not `migrate dev`) to apply.

2d. Run `prisma generate` to regenerate the Prisma client. Then run Kysely type generation (`prisma-kysely`) so the `Restaurant` type in `kysely-types.ts` gains the 4 new columns.

**Step 3 — Infrastructure: Seed**

3a. `packages/api/prisma/seed.ts` — add `seedPhase8` function after `seedPhase7`:
```
export async function seedPhase8(client: PrismaClient): Promise<void> {
  await client.dataSource.upsert({
    where: { id: '00000000-0000-0000-0000-000000000099' },
    update: {},
    create: {
      id:   '00000000-0000-0000-0000-000000000099',
      name: 'Telegram Upload',
      type: 'user',
      url:  null,
    },
  });
  console.log('Phase 8: Telegram Upload DataSource upserted.');
}
```
Add `await seedPhase8(prisma)` call in `main()` after Phase 7 block.

**Step 4 — Error handler**

4a. `packages/api/src/errors/errorHandler.ts` — add a new `DUPLICATE_RESTAURANT` case block in `mapError()`:
```typescript
if (asAny['code'] === 'DUPLICATE_RESTAURANT') {
  return {
    statusCode: 409,
    body: {
      success: false,
      error: {
        message: error.message,
        code: 'DUPLICATE_RESTAURANT',
      },
    },
  };
}
```
Place this block before the generic 500 fallthrough.

**Step 5 — Admin prefix**

5a. `packages/api/src/plugins/adminPrefixes.ts` — The current `isAdminRoute(url)` checks URL prefix strings. `POST /restaurants` lives at the same URL as `GET /restaurants` (a public route). Admin protection for POST must therefore be method-aware.

Decision: extend `isAdminRoute` to accept an optional `method` parameter:
```typescript
export function isAdminRoute(url: string | undefined, method?: string): boolean {
  if (!url) return false;
  // Method-specific admin routes
  if (url === '/restaurants' && method === 'POST') return true;
  // Prefix-based admin routes (existing)
  return ADMIN_PREFIXES.some((prefix) => url.startsWith(prefix));
}
```
The `ADMIN_PREFIXES` array stays unchanged. The global auth hook in `auth.ts` passes `request.method` as the second argument: `isAdminRoute(url, request.method)`. This way `GET /restaurants` → public API key path, `POST /restaurants` → admin path (validates `X-API-Key` against `ADMIN_API_KEY`). No new headers needed.

5b. `packages/api/src/plugins/auth.ts` — Update the hook call from `isAdminRoute(url)` to `isAdminRoute(url, request.method)`.

5c. `CatalogPluginOptions` does NOT need `config: Config` — admin auth is handled globally, not in the handler. No changes to `rateLimit.ts` needed (it does not call `isAdminRoute`).

**Step 6 — Presentation: `catalog.ts` route changes**

6a. Add `KyselyRestaurantRow` internal interface:
```typescript
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
  dish_count: string;  // COUNT returns string from pg driver
}
```

6b. Add `mapKyselyRestaurantRow(row): RestaurantListItem` mapper. `dish_count` is already in the row from the correlated subquery — convert with `Number(row.dish_count)` internally (same convention as `mapKyselyDishRow`).

6c. `CatalogPluginOptions` stays unchanged — admin auth is handled by the global hook (Step 5), not in the handler. No `config` parameter needed.

6d. Modify `GET /restaurants` handler:
- Destructure `q` from `request.query` (in addition to existing params).
- Add `q` to `cacheKey` computation via `stableKey`.
- Branch: if `q` is present → Kysely trigram path; else → existing Prisma path (unchanged).
- Kysely trigram path:
  - `selectFrom('restaurants as r')` with a LEFT JOIN subquery (or inline aggregate) for dish count, or use a correlated subquery via `sql` tagged template.
  - `WHERE similarity(r.name, ${q}) > 0.15`
  - `ORDER BY similarity(r.name, ${q}) DESC`
  - `LIMIT pageSize OFFSET (page-1)*pageSize`
  - Separate count query for pagination.
  - Apply existing filters (`countryCode`, `chainSlug`, `isActive`) on the Kysely query via `.where()` chaining.
  - Map rows with `mapKyselyRestaurantRow`.
- Include `address` in the Prisma path's item mapping (it will be `null` until data is added, but the field must be present).

Kysely query shape for the trigram path (no JOIN needed — dish count can be a correlated subquery for simplicity given small table size, ~30 restaurants):
```sql
SELECT
  r.id, r.name, r.name_es, r.chain_slug, r.country_code,
  r.is_active, r.logo_url, r.website, r.address,
  (SELECT COUNT(*) FROM dishes d WHERE d.restaurant_id = r.id) AS dish_count
FROM restaurants r
WHERE similarity(r.name, $1) > 0.15
  [AND r.country_code = $2]
  [AND r.chain_slug = $3]
  [AND r.is_active = $4]
ORDER BY similarity(r.name, $1) DESC
LIMIT $n OFFSET $m
```

6e. Add `POST /restaurants` handler at the end of the plugin (before `export`):
```
POST /restaurants
  schema: { body: CreateRestaurantBodySchema, tags: ['Catalog'], operationId: 'createRestaurant' }

Handler logic:
  1. Admin auth handled globally by onRequest hook (Step 5) — no manual check needed here
  2. Parse body (Fastify schema validation already applied by Zod provider)
  3. If chainSlug absent: generate via slugify(name) + '-' + crypto.randomUUID().slice(0,4)
     Slugify: lowercase, replace spaces with '-', strip non-[a-z0-9-] chars, collapse multiple '-'
  4. prisma.restaurant.create({ data: { ...body, chainSlug } })
     Wrap in try/catch:
       Prisma P2002 (unique constraint) → throw { code: 'DUPLICATE_RESTAURANT', message: 'Restaurant already exists for this chain and country' }
       Other Prisma errors → throw { code: 'DB_UNAVAILABLE' }
  5. reply.status(201).send({ success: true, data: createdRow })
```

The `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` is the correct check for unique constraint violations.

**Step 7 — Tests**

7a. **`f032.catalog.route.test.ts`** (unit/route tests, mocked DB):

Set up: same mock structure as `f025.catalog.route.test.ts` — mock `../lib/redis.js`, `../lib/prisma.js`, `../lib/kysely.js` via `vi.hoisted`. Add `mockRestaurantCreate: vi.fn()` to the Prisma mock.

Test cases — `GET /restaurants?q=<name>` (trigram path):
- Returns 200 with items array when Kysely `execute` returns restaurant rows
- Response items validate against `RestaurantListItemSchema`
- Returns 200 with empty items when Kysely returns `[]` and count is `0`
- Returns 400 `VALIDATION_ERROR` when `q=` (empty string, minLength violation)
- Returns 400 `VALIDATION_ERROR` when `q` is 101 chars (maxLength violation)
- All existing filters still work: `?q=mc&countryCode=ES` passes `country_code` condition to Kysely
- Returns 500 `DB_UNAVAILABLE` when Kysely throws

Test cases — `GET /restaurants` without `q` (Prisma path unchanged):
- Existing tests from `f025.catalog.route.test.ts` re-verified: no regression

Test cases — `POST /restaurants`:
- Returns 201 with created record when body is valid chain restaurant
- Returns 201 with auto-generated `chainSlug` when `chainSlug` omitted (verify slug matches `independent-...-XXXX` pattern)
- Returns 400 `VALIDATION_ERROR` when `name` is missing
- Returns 400 `VALIDATION_ERROR` when `countryCode` is lowercase (`es`)
- Returns 400 `VALIDATION_ERROR` when `chainSlug` contains uppercase
- Returns 401 `UNAUTHORIZED` when `X-API-Key` header is absent or wrong (ensure `ADMIN_API_KEY` is set in test config via `buildApp({ config: { ...testConfig, ADMIN_API_KEY: 'test-admin-key' } })` and send no header or wrong header)
- Returns 409 `DUPLICATE_RESTAURANT` when Prisma throws `PrismaClientKnownRequestError` with code `P2002`
- Returns 500 `DB_UNAVAILABLE` when Prisma throws a non-P2002 error

7b. **`f032.catalog.edge-cases.test.ts`** (pure unit tests, no HTTP):

- `CreateRestaurantBodySchema` accepts valid body with all optional fields present
- `CreateRestaurantBodySchema` rejects `chainSlug: 'MyChain'` (uppercase)
- `CreateRestaurantBodySchema` rejects `chainSlug: 'my chain'` (space)
- `RestaurantListQuerySchema` coerces `q` with `.trim()` (leading/trailing spaces stripped)
- `RestaurantListQuerySchema` rejects `q: ''` (empty after trim)
- `RestaurantSchema` now includes `address`, `googleMapsUrl`, `latitude`, `longitude`
- `mapError` with `{ code: 'DUPLICATE_RESTAURANT' }` returns `{ statusCode: 409, body.error.code: 'DUPLICATE_RESTAURANT' }`
- Slug auto-generation: import `generateIndependentSlug` from `utils/slugify.ts` — given `name='McDonald's Burgos'`, generated slug matches `/^independent-[a-z0-9-]+-[a-z0-9]{4}$/`

7c. **`seed.phase8.integration.test.ts`** (integration test, real test DB):

Pattern: follow `seed.phase6.integration.test.ts` (or similar).
```typescript
import { seedPhase8 } from '../../prisma/seed.js';
// beforeAll: cleanup (delete DataSource id=0099 if exists)
// it: seedPhase8(prisma)
// assertions: prisma.dataSource.findUnique({ where: { id: '00000000-0000-0000-0000-000000000099' }})
//   → expect name='Telegram Upload', type='user', url=null
// it (idempotent): seedPhase8(prisma) second call succeeds (no throw)
// afterAll: cleanup
```

---

### Testing Strategy

**Test files to create:**
- `packages/api/src/__tests__/f032.catalog.route.test.ts` — route tests (mocked)
- `packages/api/src/__tests__/f032.catalog.edge-cases.test.ts` — unit + schema tests
- `packages/api/src/__tests__/seed.phase8.integration.test.ts` — seed integration test

**Happy path scenarios:**
- `GET /restaurants?q=mcdon` → trigram results ordered by similarity DESC
- `GET /restaurants?q=mcdon&countryCode=ES` → filtered + similarity ordered
- `GET /restaurants` (no `q`) → Prisma path, unchanged behaviour
- `POST /restaurants` with `chainSlug` → 201 with exact slug
- `POST /restaurants` without `chainSlug` → 201 with auto-generated `independent-...-xxxx` slug
- Seed Phase 8 → Telegram Upload DataSource in DB

**Edge case scenarios:**
- `GET /restaurants?q=` → 400 (empty string violates minLength:1 after trim)
- `GET /restaurants?q=<101-chars>` → 400 (maxLength:100 violation)
- No trigram matches → 200 with `items: []`, `totalItems: 0`, `totalPages: 0`
- Two independent restaurants same name + country → both allowed (UUID fragment ensures uniqueness)

**Error scenarios:**
- `POST /restaurants` — missing `name` → 400
- `POST /restaurants` — lowercase `countryCode` → 400
- `POST /restaurants` — no `X-API-Key` → 401
- `POST /restaurants` — duplicate (chainSlug, countryCode) → 409 `DUPLICATE_RESTAURANT`
- `POST /restaurants` — DB down → 500 `DB_UNAVAILABLE`
- `GET /restaurants?q=x` — Kysely throws → 500 `DB_UNAVAILABLE`

**Mocking strategy:**
- Route tests: mock `../lib/redis.js`, `../lib/prisma.js`, `../lib/kysely.js` and estimation engine modules using `vi.hoisted` + `vi.mock` (mirror `f025.catalog.route.test.ts` exactly)
- Add `mockRestaurantCreate: vi.fn()` to the Prisma mock object
- Edge case / unit tests: no mocking, test pure functions and Zod schemas directly
- Seed integration test: real Prisma client against `DATABASE_URL_TEST`, explicit `beforeAll`/`afterAll` cleanup

---

### Key Patterns

**Dual Prisma/Kysely pattern** — `packages/api/src/routes/catalog.ts` lines 273–338: `if (search) { /* Kysely */ } else { /* Prisma */ }`. Apply the identical branching for `if (q) { /* Kysely */ } else { /* Prisma */ }` in `GET /restaurants`.

**Kysely trigram WHERE clause** — `catalog.ts` line 290:
```typescript
.where(sql<SqlBool>`similarity(r.name, ${q}) > 0.15`)
```
Note: restaurant names are English-only (no `name_es` trigram needed). Use `similarity(r.name, ${q})` only.

**Kysely ORDER BY similarity** — `catalog.ts` line 312:
```typescript
.orderBy(sql`similarity(r.name, ${q}) DESC`)
```

**Dish count in Kysely path** — use a correlated subquery via `sql` tagged template for the `dish_count` column to avoid a complex GROUP BY:
```typescript
sql<string>`(SELECT COUNT(*) FROM dishes WHERE restaurant_id = r.id)`.as('dish_count')
```
in the `.select([...])` array.

**Kysely filter chaining** — build the base query, then conditionally chain `.where()` for each optional filter. Use let-reassignment pattern (as in `GET /dishes/search`).

**Admin auth via global hook** — `isAdminRoute('/restaurants', 'POST')` returns `true`, so the global `onRequest` hook in `auth.ts` validates `X-API-Key` against `ADMIN_API_KEY` automatically. No handler-level auth code needed. The bot sends `X-API-Key: <ADMIN_API_KEY>` — one header, same as all other admin endpoints.

Fail-open in test: if `ADMIN_API_KEY` absent + `NODE_ENV=test` → hook skips auth (existing behavior). In prod/dev: mandatory.

**Prisma P2002 detection** — `@prisma/client` exports `Prisma.PrismaClientKnownRequestError`. Check `err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'`.

**Slug auto-generation** — implement as an exported helper in `packages/api/src/utils/slugify.ts` (testable via direct import):
```typescript
export function generateIndependentSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 4);
  return `independent-${slug}-${uid}`;
}
```
Import `crypto` from `node:crypto` (already available in Node 21+). The 4-char suffix from a UUID fragment gives sufficient collision resistance for independent restaurants in the same country.

**Decimal fields in Prisma create** — `latitude` and `longitude` are `Decimal?` in Prisma. When received from the JSON body as `number`, Prisma accepts plain JS numbers for `Decimal` fields (no special wrapping needed). After creation, they arrive back as `Prisma.Decimal` objects — convert with `.toNumber()` when building the response.

**Migration timestamp** — next timestamp in sequence after `20260321160000` (F029). Use `20260324170000` (2026-03-24, 17:00:00).

**Kysely types regeneration** — the `Restaurant` type in `kysely-types.ts` will be stale after the migration until `prisma-kysely` regenerates. The developer must run the generation command before implementing the Kysely query path. In the test file, cast the Kysely row as `KyselyRestaurantRow` (the local interface) rather than using the generated type directly, so tests don't break on stale types.

**Cache key includes `q`** — in `GET /restaurants`, add `q` to `stableKey({ countryCode, chainSlug, isActive, page, pageSize, q })` so trigram results are cached separately from non-trigram results.

**`address` in Prisma path** — the existing Prisma `findMany` select is implicit (no `select:` clause), so `address` will be returned automatically once the migration adds the column and Prisma client is regenerated. The item mapping in the handler must be updated to include `address: rest.address ?? null` in the returned object.

**`POST /restaurants` response shape** — return the full created restaurant record. Do not run a separate `findUnique` after create; Prisma `create()` returns all scalar fields. Map `latitude`/`longitude` Decimal fields to numbers using `.toNumber()` before returning.

**Gotcha: `Decimal?` in POST body** — Zod schema uses `z.number()` for `latitude`/`longitude`. Prisma accepts JS numbers for Decimal fields on insert. No `new Prisma.Decimal(...)` wrapper needed.

**Gotcha: `address` not in `RestaurantListItemSchema` today** — adding it is a non-breaking addition (new nullable field). Existing callers (bot `listRestaurants`) receive the field silently. The bot `ApiClient`/formatters do not need changes for F032 backend.

**Gotcha: `POST /restaurants` is not rate-limited for admin** — admin routes are in the `allowList` of `rateLimit.ts`. Since `/restaurants` POST is NOT in `adminPrefixes`, it falls through to the regular API-key tier. This is acceptable for an admin-only endpoint (callers must supply the header). No change needed.

**Namespace note** — DataSource `00000000-0000-0000-0000-000000000099` is reserved for Telegram Upload per the spec. This is intentionally outside the sequential namespace (which stops at `...0017` for LLM) to make it visually distinct as a bot-specific source.

---

### Bot Implementation

#### Context: Bot Architecture

The bot is a stateless Node.js process (`packages/bot/`). All commands return a `Promise<string>` (MarkdownV2 text) that `wrapHandler` in `bot.ts` sends via `bot.sendMessage`. There is currently no Redis dependency, no inline keyboard usage, and no `callback_query` handler — F032 introduces all three.

Key constraint: `node-telegram-bot-api` inline keyboards require `sendMessage` to receive `reply_markup: { inline_keyboard: [...] }` as a send option. The existing `send()` helper in `bot.ts` uses `{ parse_mode: 'MarkdownV2' }` only. The `/restaurante` command needs a different send path that merges both options.

Key constraint: commands that need to send inline keyboards cannot use the `wrapHandler(() => Promise<string>)` pattern — that pattern only returns text. The `/restaurante` handler must be wired directly (not through `wrapHandler`) and call `bot.sendMessage` itself.

---

#### Existing Bot Code to Reuse

- **`bot.ts`** — `buildBot()`, `wrapHandler`, `send` helper, `KNOWN_COMMANDS` set
- **`apiClient.ts`** — `ApiClient` interface, `createApiClient()`, `ApiError`, `fetchJson` (private), `REQUEST_TIMEOUT_MS` — extend with 2 new methods
- **`config.ts`** — `BotEnvSchema`, `parseConfig()` — add `ADMIN_API_KEY` and `REDIS_URL`
- **`commands/errorMessages.ts`** — `handleApiError()` — reuse for API call error formatting
- **`commands/restaurantes.ts`** — read for structural reference (args parsing, API call, error handling)
- **`formatters/markdownUtils.ts`** — `escapeMarkdown()`, `truncate()` — reuse in new formatter
- **`formatters/restaurantFormatter.ts`** — `formatRestaurantList()` — reuse for the text fallback path; extend or create a companion for search results
- **`__tests__/commands.test.ts`** — `makeMockClient()`, `TEST_CONFIG`, fixture pattern — follow exactly
- **`__tests__/bot.test.ts`** — `vi.mock('node-telegram-bot-api', ...)` mock shape — extend with `answerCallbackQuery` and `editMessageText` mock methods

---

#### Files to Create

1. **`packages/bot/src/lib/botRedis.ts`**
   ioredis singleton for the bot, mirroring the API's `packages/api/src/lib/redis.ts` pattern. Exports `botRedis` instance (lazy connect) plus `connectBotRedis()` / `disconnectBotRedis()`. Reads `REDIS_URL` from `BotConfig`.

2. **`packages/bot/src/lib/conversationState.ts`**
   Pure Redis conversation state module. Exports:
   - `BotState` type: `{ restaurantId?: string; restaurantName?: string; pendingSearch?: string; searchResults?: Array<{ id: string; name: string }> }`
   - `getState(redis, chatId): Promise<BotState | null>`
   - `setState(redis, chatId, state): Promise<void>` — TTL 7200 seconds (2 hours)
   - `clearState(redis, chatId): Promise<void>`
   Key format: `bot:state:{chatId}`. Fail-open on Redis errors (log + return null / swallow).

3. **`packages/bot/src/commands/restaurante.ts`**
   Handler for the `/restaurante` command. Signature: `handleRestaurante(args: string, chatId: number, bot: TelegramBot, apiClient: ApiClient, redis: Redis): Promise<void>`. The handler sends messages directly (not returns a string) because it needs to attach inline keyboards. Logic:
   - If args empty → read state from Redis → send current context message (or "no hay restaurante seleccionado")
   - If args non-empty → call `apiClient.searchRestaurants(q)` → build inline keyboard (max 5) → send via `bot.sendMessage` with `reply_markup`
   - If search returns 0 results → send message with single "Crear restaurante" inline button

4. **`packages/bot/src/handlers/callbackQuery.ts`**
   Handles `callback_query` events. Exports `handleCallbackQuery(query: TelegramBot.CallbackQuery, bot: TelegramBot, apiClient: ApiClient, redis: Redis): Promise<void>`. Parses `query.data` string (compact format: `sel:{uuid}` or `create_rest`) and dispatches to the appropriate sub-handler. Full restaurant names/search queries are recovered from Redis bot state (`searchResults`, `pendingSearch`), NOT from callback_data (Telegram 64-byte limit). Always calls `bot.answerCallbackQuery(query.id)` to dismiss the loading spinner.

5. **`packages/bot/src/__tests__/f032.restaurante.test.ts`**
   Unit tests for `handleRestaurante` command handler. Mocks `ApiClient` and the `botRedis` / `conversationState` module.

6. **`packages/bot/src/__tests__/f032.callbackQuery.test.ts`**
   Unit tests for `handleCallbackQuery`. Mocks `TelegramBot`, `ApiClient`, and `conversationState`.

7. **`packages/bot/src/__tests__/f032.conversationState.test.ts`**
   Unit tests for `getState` / `setState` / `clearState`. Mocks the ioredis instance.

8. **`packages/bot/src/__tests__/f032.apiClient.test.ts`**
   Unit tests for the two new `ApiClient` methods: `searchRestaurants` and `createRestaurant`.

---

#### Files to Modify

1. **`packages/bot/src/config.ts`**
   Add to `BotEnvSchema`:
   - `ADMIN_API_KEY: z.string().min(1).optional()` — optional so the bot still starts in dev without it; runtime check inside `createRestaurant` handler
   - `REDIS_URL: z.string().url().default('redis://localhost:6380')` — same default as the API

2. **`packages/bot/src/apiClient.ts`**
   Add two methods to the `ApiClient` interface and implement them in `createApiClient()`:
   - `searchRestaurants(q: string): Promise<PaginatedResult<RestaurantListItem>>` — calls `GET /restaurants?q=<q>&pageSize=5` via `fetchJson`
   - `createRestaurant(body: CreateRestaurantBody): Promise<Restaurant>` — calls `POST /restaurants` with body. Uses `X-API-Key: <ADMIN_API_KEY>` (the bot's API key IS the admin key for admin endpoints). Add a private `postJson<T>(path, body)` helper inside `createApiClient()` with the same error handling and timeout as `fetchJson`, but with method POST and JSON body. Returns the full `Restaurant` type (includes `createdAt`, location fields, etc.). Import `CreateRestaurantBody`, `Restaurant` from `@foodxplorer/shared`.

3. **`packages/bot/src/bot.ts`**
   - Add `'restaurante'` to `KNOWN_COMMANDS`
   - Add `ioredis` import and `Redis` type (for passing the instance)
   - Change `buildBot` signature to `buildBot(config: BotConfig, apiClient: ApiClient, redis: Redis): TelegramBot`
   - Register `/restaurante` with `onText(/^\/restaurante(?:@\w+)?(?:\s+(.+))?$/, ...)` — wired directly (not through `wrapHandler`) since the handler sends its own messages
   - Register `bot.on('callback_query', ...)` using `handleCallbackQuery`
   - Import and wire `handleRestaurante` and `handleCallbackQuery`

4. **`packages/bot/src/index.ts`**
   - Import `connectBotRedis` / `disconnectBotRedis` from `lib/botRedis.ts`
   - Import `botRedis` instance
   - Call `connectBotRedis()` before `buildBot()`
   - Pass `botRedis` to `buildBot()`
   - Add `disconnectBotRedis()` to shutdown sequence

5. **`packages/bot/package.json`**
   Add `"ioredis": "^5.4.2"` to `dependencies` (same version as API package).

6. **`packages/bot/src/__tests__/bot.test.ts`**
   - Update `vi.mock('node-telegram-bot-api', ...)` to add `answerCallbackQuery: vi.fn()` and `editMessageText: vi.fn()` to the mock instance
   - Update the `buildBot` call signature to pass a mock `redis` instance (e.g., `{} as Redis` or a minimal mock)
   - Update the assertion `'registers onText exactly 8 times'` → 9 times (adding `/restaurante`)
   - Add test: `bot.on` is called with `'callback_query'`

---

#### Implementation Order

1. **`packages/bot/package.json`** — add `ioredis` dependency

2. **`packages/bot/src/config.ts`** — add `ADMIN_API_KEY` and `REDIS_URL` to `BotEnvSchema`

3. **`packages/bot/src/lib/botRedis.ts`** — ioredis singleton, mirrors API's `redis.ts`

4. **`packages/bot/src/lib/conversationState.ts`** — `BotState` type + `getState` / `setState` / `clearState`

5. **`packages/bot/src/__tests__/f032.conversationState.test.ts`** — tests for conversationState (TDD: write before or alongside step 4)

6. **`packages/bot/src/apiClient.ts`** — add `searchRestaurants` and `createRestaurant` to interface + implementation; add `ADMIN_API_KEY` parameter to `createApiClient` signature (receive it from config)

7. **`packages/bot/src/__tests__/f032.apiClient.test.ts`** — tests for the two new ApiClient methods (TDD)

8. **`packages/bot/src/commands/restaurante.ts`** — `/restaurante` command handler (search path + show-current-context path)

9. **`packages/bot/src/__tests__/f032.restaurante.test.ts`** — tests for `handleRestaurante` (TDD)

10. **`packages/bot/src/handlers/callbackQuery.ts`** — callback query dispatcher (select restaurant → save to Redis; create restaurant → call API → save to Redis)

11. **`packages/bot/src/__tests__/f032.callbackQuery.test.ts`** — tests for `handleCallbackQuery` (TDD)

12. **`packages/bot/src/bot.ts`** — wire `/restaurante` + `callback_query`; update `buildBot` signature

13. **`packages/bot/src/index.ts`** — pass `botRedis` to `buildBot`, add connect/disconnect lifecycle

14. **`packages/bot/src/__tests__/bot.test.ts`** — update mock shape and assertion counts

---

#### Testing Strategy

**Files to create:**
- `packages/bot/src/__tests__/f032.conversationState.test.ts`
- `packages/bot/src/__tests__/f032.apiClient.test.ts`
- `packages/bot/src/__tests__/f032.restaurante.test.ts`
- `packages/bot/src/__tests__/f032.callbackQuery.test.ts`

**Mocking strategy:**
- No real Redis, no real Telegram, no real HTTP in any test
- Mock ioredis: create a minimal mock object `{ get: vi.fn(), set: vi.fn(), del: vi.fn() }` — pass it directly as a parameter (no module-level mock needed because `conversationState.ts` accepts redis as a parameter)
- Mock `ApiClient`: extend existing `makeMockClient()` in `commands.test.ts` fixture with `searchRestaurants: vi.fn()` and `createRestaurant: vi.fn()` — copy the helper into the new test files (do not import from `commands.test.ts`)
- Mock `TelegramBot` instance: pass a plain object `{ sendMessage: vi.fn(), answerCallbackQuery: vi.fn() }` — same pattern as `bot.test.ts`
- For `f032.apiClient.test.ts`: stub global `fetch` via `vi.stubGlobal('fetch', fetchMock)` + `vi.unstubAllGlobals()` in `afterEach` — identical to `f029.bot-edge-cases.test.ts`

**`f032.conversationState.test.ts` — key scenarios:**
- `getState` returns null when Redis `get` returns null (cache miss)
- `getState` returns parsed `BotState` when Redis `get` returns valid JSON
- `getState` returns null (fail-open) when Redis `get` throws
- `setState` calls Redis `set` with key `bot:state:{chatId}`, the serialised state, `EX`, and `7200`
- `setState` does not throw (fail-open) when Redis `set` throws
- `clearState` calls Redis `del` with the correct key
- `clearState` does not throw (fail-open) when Redis `del` throws

**`f032.apiClient.test.ts` — key scenarios:**
- `searchRestaurants('mcdon')` calls `GET /restaurants?q=mcdon&pageSize=5` and returns the `data` envelope
- `searchRestaurants` sends `X-FXP-Source: bot` header
- `searchRestaurants` throws `ApiError` on non-2xx response
- `createRestaurant(body)` calls `POST /restaurants` with `Content-Type: application/json`, `X-API-Key: <ADMIN_API_KEY>`, and serialised body
- `createRestaurant` sends `X-FXP-Source: bot`
- `createRestaurant` throws `ApiError(409, 'DUPLICATE_RESTAURANT', ...)` when API returns 409

**`f032.restaurante.test.ts` — key scenarios:**
- Empty args + no Redis state → sends "no hay restaurante seleccionado" text message
- Empty args + existing Redis state → sends current context message with restaurantName
- Non-empty args → calls `searchRestaurants` with trimmed args
- Search returns 1–5 results → saves results to Redis state (`searchResults`), calls `bot.sendMessage` with `reply_markup.inline_keyboard` containing one button per result; button text is restaurant name; `callback_data` is `sel:{id}`
- Search returns 0 results → saves `pendingSearch` to Redis state, calls `bot.sendMessage` with a single "Crear restaurante" button; `callback_data` is `create_rest`
- Search returns >5 results → only first 5 shown (enforced by `pageSize=5` in the API call)
- `searchRestaurants` throws `ApiError` → sends error message via `handleApiError`

**`f032.callbackQuery.test.ts` — key scenarios:**
- `callback_data: 'sel:{id}'` → looks up name in `state.searchResults`, calls `setState` with `{ restaurantId, restaurantName }`, calls `bot.answerCallbackQuery(query.id)`, sends confirmation text
- `callback_data: 'create_rest'` → reads `state.pendingSearch` for name, calls `apiClient.createRestaurant` with `{ name, countryCode: 'ES' }`, calls `setState` with new restaurantId/name, calls `bot.answerCallbackQuery`, sends confirmation text
- `createRestaurant` throws `ApiError(409, 'DUPLICATE_RESTAURANT', ...)` → sends "restaurante ya existe" message
- `createRestaurant` throws generic `ApiError` → sends error message via `handleApiError`
- Unknown `callback_data` prefix → calls `answerCallbackQuery` and silently ignores (no message sent)
- `query.message` is undefined → handler exits early without crashing

---

#### Key Patterns and Gotchas

**Inline keyboard send pattern** — `sendMessage` with both `parse_mode` and `reply_markup` simultaneously:
```typescript
await bot.sendMessage(chatId, text, {
  parse_mode: 'MarkdownV2',
  reply_markup: {
    inline_keyboard: [[{ text: 'Restaurant Name', callback_data: 'sel:uuid-here' }]],
  },
});
```
Each result occupies one row (one button per row). Max 5 rows.

**Callback data format** — compact payloads only, NO names in callback_data (Telegram 64-byte limit). Formats:
- `sel:{uuid}` — select restaurant (4 + 36 = 40 bytes, well within limit)
- `create_rest` — create restaurant from pending search (11 bytes)

The handler recovers full names from Redis bot state:
- On `/restaurante <name>` search: save `{ pendingSearch: name, searchResults: [{id, name}, ...] }` to Redis state
- On `sel:{uuid}` callback: look up `uuid` in `state.searchResults` to get full name
- On `create_rest` callback: read `state.pendingSearch` for the restaurant name to create

This avoids all 64-byte limit issues and keeps state consistent.

**`wrapHandler` is NOT used for `/restaurante`** — the existing `wrapHandler` wrapper expects the handler to return a `Promise<string>` which it then sends. The `/restaurante` handler calls `bot.sendMessage` itself (required to attach `reply_markup`). Wire it directly:
```typescript
bot.onText(
  /^\/restaurante(?:@\w+)?(?:\s+(.+))?$/,
  async (msg, match) => {
    try {
      await handleRestaurante(match?.[1] ?? '', msg.chat.id, bot, apiClient, redis);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled /restaurante error');
      try { await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.')); } catch { /* ignore */ }
    }
  },
);
```

**`callback_query` handler** — wire via `bot.on`:
```typescript
bot.on('callback_query', async (query) => {
  try {
    await handleCallbackQuery(query, bot, apiClient, redis);
  } catch (err) {
    logger.error({ err }, 'Unhandled callback_query error');
  }
});
```

**`buildBot` signature change is breaking** — `index.ts` is the only caller outside tests. Update `index.ts` in the same commit as `bot.ts`. In `bot.test.ts`, pass a minimal redis mock: `const mockRedis = { get: vi.fn(), set: vi.fn(), del: vi.fn() } as unknown as Redis`.

**`countryCode` in `createRestaurant`** — the `/restaurante` flow does not ask the user for a country. For F032, hardcode `countryCode: 'ES'` as the default (Spain-only bot per the spec). Add a comment noting this should be made dynamic in a future ticket.

**No `fetchJson` re-use for `createRestaurant`** — `fetchJson` in `apiClient.ts` only handles GET-style calls (no body, GET headers only). For `createRestaurant`, write a separate `postJson<T>(path, body)` private helper inside `createApiClient()`. Uses `X-API-Key: <config.ADMIN_API_KEY>` (the bot uses the admin key for write endpoints). Keep the same error handling and timeout pattern as `fetchJson`.

**ioredis in bot tests** — do NOT mock the `botRedis` module at module level. Instead, `conversationState.ts` and `callbackQuery.ts` should accept the redis instance as a parameter (dependency injection). This keeps tests clean and avoids `vi.hoisted` complexity. The redis singleton from `botRedis.ts` is only used in `bot.ts` and `index.ts` (wiring layer).

**`ADMIN_API_KEY` availability in `createApiClient`** — `createApiClient(config)` already receives `BotConfig`. After adding `ADMIN_API_KEY` to `BotEnvSchema`, it will be available as `config.ADMIN_API_KEY` inside `createApiClient`. The `postJson` helper reads it from the closure.

**`KNOWN_COMMANDS` update in `bot.ts`** — add `'restaurante'` to the set. If omitted, the unknown-command catch-all in `bot.on('message', ...)` will fire alongside the `onText` handler, sending two replies for `/restaurante` commands.

**bot.test.ts `onText` count** — the test `'registers onText exactly 8 times'` will fail once `/restaurante` is added. Update to `9 times`. Also add a test: `the /restaurante regex matches "/restaurante McDonald's"` and `"/restaurante" alone`.

**Fail-open on Redis errors** — both `conversationState.ts` and the `/restaurante` handler must treat Redis failures as degraded-but-functional: if `getState` returns null due to a Redis error, show the "no context" message. If `setState` fails, still confirm the selection to the user. Log warnings but never throw to the user.

---

## Acceptance Criteria

- [ ] Prisma migration adds `address`, `googleMapsUrl`, `latitude`, `longitude` to `restaurants`
- [ ] `GET /restaurants?q=<name>` returns trigram-ranked results
- [ ] `GET /restaurants?q=<name>` combines with existing filters (countryCode, chainSlug, isActive)
- [ ] `POST /restaurants` creates chain restaurant with explicit chainSlug
- [ ] `POST /restaurants` auto-generates slug for independent restaurants (no chainSlug provided)
- [ ] `POST /restaurants` returns 409 on duplicate (chainSlug, countryCode)
- [ ] `POST /restaurants` returns 401 without admin key
- [ ] Bot `/restaurante <name>` searches and displays results with inline keyboard
- [ ] Bot creation flow: "not found" -> create prompt -> user provides name -> restaurant created
- [ ] Bot conversation state persisted in Redis (`bot:state:{chatId}`, TTL 2h)
- [ ] "Telegram Upload" DataSource seeded with fixed UUID
- [ ] Shared Zod schemas updated (RestaurantSchema, RestaurantListItemSchema, CreateRestaurantBodySchema)
- [ ] API spec updated (`api-spec.yaml`)
- [ ] Unit tests for new functionality
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` + `frontend-planner` (bot) executed, plan approved
- [ ] Step 3: `backend-developer` + `frontend-developer` (bot) executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-24 | Step 0: Spec | API spec updated, spec summary written |
| 2026-03-24 | Step 1: Setup | Branch feature/F032-restaurant-resolution-creation, full ticket |
| 2026-03-24 | Step 2: Plan | Backend + bot plans written. Self-review: 3 fixes. External review by Gemini + Codex: 2 CRITICAL + 3 IMPORTANT + 2 SUGGESTION → 7 fixes applied (auth method-aware, callback data compact, return type, slug util, test config, state simplification, pg_trgm note) |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |

---

*Ticket created: 2026-03-24*
