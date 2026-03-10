# Architectural Decisions

Track important technical decisions with context, so future sessions understand WHY things are the way they are.

## Format

```markdown
### ADR-XXX: Decision Title (YYYY-MM-DD)

**Context:** Why the decision was needed
**Decision:** What was chosen
**Alternatives Considered:** Options and why rejected
**Consequences:** Benefits and trade-offs
```

---

<!-- Add ADR entries below this line -->

### ADR-000: Initial Stack and Architecture (2026-03-10)

**Context:** Selecting the technology stack for a nutritional information platform focused on Spanish restaurants. The product needs: relational data with complex joins, vector similarity search (pgvector), real-time API, Telegram bot, and future web/mobile apps. Single founder with 20+ years Node.js experience.

**Decision:**
- **Runtime:** Node.js + TypeScript (strict mode)
- **API Framework:** Fastify (over Express, NestJS)
- **ORM Strategy:** Prisma (migrations + CRUD) + Kysely (complex queries, pgvector)
- **Database:** PostgreSQL 16 + pgvector extension + JSONB for flexible micronutrient data
- **Cache:** Redis (LLM response cache + API rate limiting)
- **Validation:** Zod schemas in shared workspace (single source of truth)
- **Monorepo:** npm workspaces (`packages/api`, `packages/bot`, `packages/shared`)
- **Branching:** gitflow (main + develop + feature/*)
- **Infra:** Docker Compose for local dev; Railway/Render for staging/prod (early stage)

**Alternatives Considered:**
- Python: Rejected — team expertise is Node.js (20+ years)
- MongoDB: Rejected — complex relational model (foods → nutrients → dishes → restaurants) requires SQL; flexibility covered by JSONB columns
- Express: Rejected — lower performance, no built-in OpenAPI generation
- NestJS: Rejected — excessive overhead for MVP
- Only Prisma: Rejected — limited pgvector support, poor control of complex aggregations
- Only Kysely: Rejected — less robust migration management
- SQL puro: Rejected — no managed migrations

**Consequences:**
- (+) Type safety end-to-end with Zod + Prisma + Kysely
- (+) pgvector integrated in PostgreSQL — no separate vector store needed
- (+) Fastify auto-generates OpenAPI docs
- (-) Two query layers (Prisma + Kysely) require clear usage rules (documented in key_facts.md)
- (-) npm workspaces less mature than Turborepo, but sufficient for 3 packages

### ADR-001: Estimation Engine — Motor Calculates, LLM Interprets (2026-03-10)

**Context:** The core product is a nutritional estimation engine. The temptation is to use the LLM to calculate nutritional values directly. This would be faster to build but unreliable and unauditable.

**Decision:** The estimation engine is deterministic and auditable. Three levels cascade: Level 1 (official data) → Level 2 (ingredient-based calculation) → Level 3 (pgvector similarity extrapolation). The LLM is used ONLY for: (a) parsing natural language queries into structured queries, (b) formatting responses. The LLM NEVER calculates nutritional values.

**Alternatives Considered:**
- LLM as calculation engine: Rejected — inconsistent results, not auditable, expensive at scale, hallucination risk on nutritional data
- Hybrid (LLM calculates + human validates): Rejected — doesn't scale, validation bottleneck

**Consequences:**
- (+) Every nutritional value is traceable to a source (data_sources table)
- (+) Confidence levels are deterministic and testable
- (+) Cost per query is predictable (Redis cache for LLM calls)
- (-) More implementation effort for Levels 2 and 3
- (-) Edge cases require fallback to LLM for ingredient parsing (documented, cached)

### ADR-002: Core Schema Design — pgvector, XOR Constraint, Dual FTS (2026-03-10)

**Context:** Designing the 4 foundational tables (`data_sources`, `foods`, `food_nutrients`, `standard_portions`) for a nutritional platform that requires vector similarity search, full-text search in two languages, and strict data integrity constraints that Prisma cannot express natively.

**Decision:**

1. **pgvector as `Unsupported` column in Prisma.** The `embedding vector(1536)` column on `foods` is declared as `Unsupported("vector(1536)")?` in `schema.prisma`. Prisma generates the `CREATE TABLE` statement including the column, so no `ALTER TABLE` is needed. All reads/writes to this column must use `prisma.$queryRaw` or `prisma.$executeRaw`. The column is NOT exposed in the shared Zod schemas (not representable as JSON).

2. **XOR constraint via raw SQL `CHECK`.** `standard_portions` must have exactly one of `food_id` or `food_group` set. Prisma cannot express CHECK constraints, so the constraint is added as raw SQL in the migration file (`ALTER TABLE ... ADD CONSTRAINT ... CHECK`). The constraint is also enforced at the Zod layer via `.refine()` on `CreateStandardPortionSchema` — both layers are required.

3. **Dual FTS indexes (Spanish + English).** `foods` has two GIN full-text search indexes: one for `name` (English, `to_tsvector('english', ...)`) and one for `name_es` (Spanish, `to_tsvector('spanish', ...)`). These cannot be expressed in Prisma schema and are added as raw SQL in the migration. The platform targets Spain, so Spanish FTS is primary, but English FTS is needed for international data sources (USDA).

4. **Migration applied with `migrate deploy` instead of `migrate dev`.** The `migrate dev` command uses a shadow database to validate the migration before applying it. The shadow database does not have the `pgvector` extension, causing validation to fail. `migrate deploy` applies migrations directly without a shadow database, which is the correct command for CI/CD and for migrations using extensions not present in the shadow DB.

**Alternatives Considered:**
- Omit embedding from Prisma schema (ALTER TABLE only): Rejected — `Unsupported` gives better Prisma Studio visibility and clearer intent in schema.
- Single FTS language: Rejected — data sources are primarily English (USDA); end-user queries are Spanish.
- Use `@@index` for FTS in Prisma: Rejected — Prisma does not support GIN or tsvector indexes; must be raw SQL.
- Express XOR only in application code: Rejected — DB constraints are the last defense against data corruption and must be independent of application code.

**Consequences:**
- (+) `embedding` column is visible in Prisma Studio and schema is self-documenting
- (+) XOR and CHECK constraints are enforced at both API and DB layers — defense in depth
- (+) Dual FTS supports multilingual search without additional infrastructure
- (-) Raw SQL in migration files requires manual maintenance if tables are altered
- (-) `migrate dev` cannot be used during development if the shadow DB lacks pgvector; use `migrate deploy` for applying existing migrations
