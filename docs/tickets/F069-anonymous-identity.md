# F069: Anonymous Identity — Actor Table + Middleware

**Feature:** F069 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F069-anonymous-identity
**Created:** 2026-04-02 | **Dependencies:** None

---

## Spec

### Description

Introduce a stable anonymous identity system via an `actors` table and resolution middleware. Every API request is associated with an `actor_id` — web clients send `X-Actor-Id` header (UUID from localStorage), Telegram bot uses `chat_id`. This enables favorites, tracking, analytics, and per-actor rate limiting from day 1 without requiring authentication. Implements ADR-016.

**Why:** The product is auth-free to maximize adoption, but features like favorites, meal logging, and abuse protection require stable identity. The actor pattern provides this without friction, and seamlessly migrates to authenticated accounts in Phase D (F107).

**Key behaviors (from ADR-016):**
- `actors` table: `id` (UUID PK), `type` (enum: anonymous_web / telegram / authenticated), `external_id` (unique per type), `locale`, `created_at`, `last_seen_at`
- Web: `X-Actor-Id` header with UUID → resolve or auto-create actor
- Telegram: `chat_id` → resolve or auto-create actor with type `telegram`
- All user-linked data references `actor_id` (starting with `query_logs`)
- Per-actor daily rate limits: 50 queries/day, 20 L4 calls/day, 10 photo analyses/day
- `request.actorId` available on all requests (Fastify type augmentation)

**Reference:** `docs/research/product-evolution-analysis-2026-03-31.md` Section 17, Foundation 2.

### API Changes

**No new public endpoints.** Internal changes:

1. New Fastify request property: `request.actorId?: string` (UUID)
2. Actor resolution middleware (onRequest hook): resolves `X-Actor-Id` header → actor row, creates if new
3. `query_logs` table gains `actor_id` column (nullable, no FK)
4. Per-actor rate limiting supplements existing IP/key-based limits

Update `docs/specs/api-spec.yaml`: document `X-Actor-Id` request header.

### Data Model Changes

**New enum:**
```prisma
enum ActorType {
  anonymous_web
  telegram
  authenticated
  @@map("actor_type")
}
```

**New model:**
```prisma
model Actor {
  id         String    @id @default(uuid()) @db.Uuid
  type       ActorType
  externalId String    @map("external_id") @db.VarChar(255)
  locale     String?   @db.VarChar(10)
  createdAt  DateTime  @default(now()) @map("created_at")
  lastSeenAt DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz
  @@unique([type, externalId])
  @@map("actors")
}
```

**Migration:** Add `actor_id` column to `query_logs` (nullable UUID, no FK constraint — same pattern as existing `api_key_id`).

### UI Changes

N/A — backend only.

### Edge Cases & Error Handling

1. **Missing X-Actor-Id header:** Auto-create anonymous actor with generated UUID. Return actor_id in response header `X-Actor-Id` so client can persist it.
2. **Invalid X-Actor-Id (not UUID):** Ignore, treat as missing (auto-create new).
3. **Bot requests:** Bot sends `X-Actor-Id` derived from chat_id. If actor doesn't exist, create with type `telegram`.
4. **Actor last_seen_at update:** Fire-and-forget (same pattern as ApiKey `last_used_at`).
5. **Rate limit exceeded:** Return 429 with `Retry-After` header. Body: `{ success: false, error: { code: 'ACTOR_RATE_LIMIT_EXCEEDED', message } }`.
6. **Redis down for rate limiting:** Fail-open for API-key-authenticated requests, fail-closed for anonymous actors (per ADR-016).
7. **Concurrent actor creation:** `@@unique([type, externalId])` constraint + upsert prevents duplicates.
8. **Health endpoint:** Excluded from actor resolution (no actor needed).

---

## Implementation Plan

### Phase 1: Schema & Types

**1.1 Prisma migration — actors table + query_logs actor_id**
- Add `ActorType` enum and `Actor` model to `schema.prisma`
- Add `actorId String? @map("actor_id") @db.Uuid` to `QueryLog` model
- Create migration `anonymous_identity_f069`
- Regenerate Kysely types

**1.2 Shared schemas**
- Add `ActorTypeSchema` to `packages/shared/src/schemas/enums.ts`
- Add `ActorSchema` to `packages/shared/src/schemas/actor.ts` (new file)

### Phase 2: Actor Resolution Middleware (TDD)

**2.1 Create `packages/api/src/plugins/actorResolver.ts`**
- Fastify plugin: `registerActorResolver(app, { prisma })`
- `onRequest` hook (runs after auth middleware):
  1. Skip `/health` endpoint
  2. Read `X-Actor-Id` header
  3. If valid UUID → upsert actor (type `anonymous_web`, external_id = UUID)
  4. If missing/invalid → generate UUID, upsert actor, set response header `X-Actor-Id`
  5. Set `request.actorId = actor.id`
  6. Fire-and-forget `last_seen_at` update
- Fastify type augmentation: `request.actorId?: string`

**2.2 Tests for actor resolver**
- Valid X-Actor-Id → resolves existing actor
- Missing header → creates new actor, returns X-Actor-Id in response
- Invalid UUID → creates new actor
- Health endpoint → skipped
- Concurrent creation → upsert handles race condition

### Phase 3: Per-Actor Rate Limiting (TDD)

**3.1 Create `packages/api/src/plugins/actorRateLimit.ts`**
- Separate from existing `rateLimit.ts` (which handles per-IP/key request-rate)
- Daily counter per actor using Redis: `actor:limit:<actorId>:<date>:<bucket>`
- Three buckets: `queries` (50/day), `l4` (20/day), `photos` (10/day)
- Check on relevant routes only:
  - `GET /estimate` → increment `queries` bucket
  - `POST /analyze/menu` → increment `photos` bucket
  - L4 usage tracked internally (in engine router, not route-level)
- Returns 429 with `ACTOR_RATE_LIMIT_EXCEEDED` when exceeded
- Fail-open for authenticated API key requests, fail-closed for anonymous

**3.2 Tests for actor rate limiting**
- Under limit → pass
- At limit → 429
- Redis down + anonymous → 429 (fail-closed)
- Redis down + API key → pass (fail-open)
- Different days → counters reset

### Phase 4: Integration

**4.1 Register middleware in app.ts**
- Add `registerActorResolver()` after auth middleware, before rate limiting
- Registration order: auth → actorResolver → rateLimit → actorRateLimit → routes

**4.2 Wire actor_id into query logger**
- Add `actorId` to `QueryLogEntry` interface
- Pass `request.actorId` in estimate route logger call

**4.3 Bot integration**
- Bot API client sends `X-Actor-Id: telegram:<chat_id>` header
- Actor resolver recognizes `telegram:` prefix → upsert with type `telegram`, external_id = chat_id

### Phase 5: Test Coverage
- Unit tests for actor resolver (Phase 2.2)
- Unit tests for actor rate limiting (Phase 3.2)
- Integration: actor_id appears in query_logs
- Verify existing test baseline not broken

---

## Acceptance Criteria

- [x] `actors` table created with correct schema (id, type, external_id, locale, timestamps)
- [x] `ActorType` enum with anonymous_web, telegram, authenticated
- [x] Unique constraint on (type, external_id)
- [x] `query_logs` has `actor_id` column (nullable UUID)
- [x] Actor resolution middleware resolves/creates actors from X-Actor-Id header
- [x] Missing/invalid X-Actor-Id → auto-create + return in response header
- [x] Bot requests create telegram-type actors
- [x] `request.actorId` available on all non-health requests
- [x] Per-actor daily rate limits enforced (50 queries, 10 photos). L4 bucket (20/day) deferred — requires engine router integration
- [x] Rate limit fail-closed for anonymous, fail-open for API key auth
- [x] `actor_id` logged in query_logs
- [x] last_seen_at updated on each request (via upsert)
- [x] Unit tests for actor resolver (9 tests)
- [x] Unit tests for actor rate limiting (14 tests)
- [x] All tests pass (25 new, no regressions)
- [x] Build succeeds
- [x] Specs updated (api-spec.yaml X-Actor-Id header)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (25 tests)
- [x] E2E tests updated (if applicable) — N/A
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-02 | Ticket created | Steps 0+1+2 combined. Spec and plan derived from ADR-016. Cross-model reviews skipped (ADR-016 reviewed by 3 models in 4 iterations; user granted extended autonomy) |
| 2026-04-02 | Implementation complete | 584a2c0 — actors table, middleware, rate limits, query logger. 12 files, 632 insertions |
| 2026-04-02 | Validator fixes | 3631f7e — return reply.send() in rate limit hook (H3), skip /docs routes (L1) |
| 2026-04-02 | PR created | #61 → develop. Code review + QA executing |
| 2026-04-02 | QA fixes | Retry-After header on fail-closed 429. F029 test fixtures (856bd77). L4 bucket deferred (engine router integration needed) |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 17/17, DoD: 7/7, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: migration list (17), actorResolver + actorRateLimit modules |
| 4. Update decisions.md | [x] | ADR-016 already existed (written pre-F069) |
| 5. Commit documentation | [x] | Commit: 3631f7e (includes tracker + key_facts updates) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit 836854a |

---

*Ticket created: 2026-04-02*
