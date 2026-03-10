# Key Project Facts

Quick reference for project configuration, infrastructure details, and important URLs.

## Security Warning

**DO NOT store in this file:** Passwords, API keys, secret tokens, private keys.
**SAFE to store:** Hostnames, ports, project IDs, public URLs, architecture notes.

---

## Project Configuration

- **Project Name**: foodXPlorer (nombre definitivo pendiente, no bloquea Fase 1)
- **Description**: Plataforma open source de referencia para conocer la información nutricional de cualquier plato, en cualquier restaurante, en cualquier contexto
- **Repository**: GitHub (público, licencia pendiente)
- **Primary Language**: TypeScript (strict mode)
- **Branching Strategy**: gitflow <!-- main (producción) + develop (integración) + feature/* -->
- **Monorepo Layout**: npm workspaces — `packages/api`, `packages/bot`, `packages/shared`

## Technology Stack

- **Runtime**: Node.js + TypeScript
- **API Framework**: Fastify (OpenAPI autogenerado, Zod validation)
- **ORM / Migrations**: Prisma (migraciones + CRUD simple)
- **Query Builder**: Kysely (queries complejas, pgvector, 3+ joins)
- **Database**: PostgreSQL 16 + pgvector + JSONB
- **Cache / Rate Limiting**: Redis
- **Bot**: node-telegram-bot-api
- **Web (Fase 2)**: Next.js (SSR/SEO)
- **Validation**: Zod (schemas compartidos en packages/shared)

## Naming Conventions (Specs & Tickets)

| Prefix | Type | Example |
|--------|------|---------|
| `EXXX` | Epic | `E001-infrastructure-setup` |
| `FXXX` | Feature | `F001-prisma-schema-core-tables` |
| `SXXX` | Schema / Migration | `S001-foods-table` |
| `TXXX` | Ticket (auto) | `T001-prisma-schema-core-tables` |
| `ADR-XXX` | Decision Record | `ADR-000-initial-stack` |
| `BUG-XXX` | Bug (auto) | `BUG-001-description` |

## Prisma vs Kysely Rule

- **Prisma**: All schema migrations, CRUD simple, relations with include, Prisma Studio
- **Kysely**: Nutritional calculations (aggregated sums), pgvector searches, 3+ joins, full-text search, any query needing precise SQL

## Local Development

- **API Port**: 3001 (avoids conflict with other local services)
- **PostgreSQL Port**: 5433 (mapped from container 5432, avoids conflict with local PG)
- **Redis Port**: 6380 (mapped from container 6379, avoids conflict with local Redis)
- **Database Name**: foodxplorer_dev
- **Database Test**: foodxplorer_test
- **API Base URL**: http://localhost:3001

## Infrastructure

- **CI/CD**: GitHub Actions
- **Hosting (early stage)**: Railway or Render (staging: develop, prod: main)
- **Error Tracking**: Sentry (free plan)
- **Uptime**: UptimeRobot or Better Uptime (free plan)

## Important URLs

- **Production**: TBD
- **Staging**: TBD
- **API Docs**: http://localhost:3001/docs (OpenAPI/Swagger)

## Reusable Components

### Backend (packages/api)
- **Prisma client**: auto-generated at `node_modules/@prisma/client` (root node_modules). Instantiate with `new PrismaClient()`. For dev/prod, use `DATABASE_URL`. For tests, override with `datasources: { db: { url: DATABASE_URL_TEST } }`.
- **Prisma schema**: `packages/api/prisma/schema.prisma` — 4 enums, 4 models
- **Migrations**: `packages/api/prisma/migrations/` — apply with `prisma migrate deploy` (not `migrate dev` due to pgvector shadow DB issue)
- **Seed script**: `packages/api/prisma/seed.ts` — run with `npm run db:seed -w @foodxplorer/api`

### Shared (packages/shared)
- _Zod schemas = single source of truth for types_
- **Enum schemas** (`packages/shared/src/schemas/enums.ts`): `DataSourceTypeSchema`, `ConfidenceLevelSchema`, `EstimationMethodSchema`, `PortionContextSchema`
- **Entity schemas** (each in its own file under `packages/shared/src/schemas/`):
  - `DataSourceSchema`, `CreateDataSourceSchema` — data_sources table shape
  - `FoodSchema`, `CreateFoodSchema` — foods table shape (no embedding field)
  - `FoodNutrientSchema`, `CreateFoodNutrientSchema` — food_nutrients table shape (nutrients as `z.number().nonnegative()`)
  - `StandardPortionSchema`, `CreateStandardPortionSchema` — standard_portions table shape (XOR `.refine()` on Create schema)
- All schemas exported from `packages/shared/src/index.ts`

### Bot (packages/bot)
- _To be populated_
