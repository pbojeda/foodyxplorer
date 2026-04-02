# F069: Anonymous Identity — Actor Table + Middleware

**Feature:** F069 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F069-anonymous-identity
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

- [ ] `actors` table created with correct schema (id, type, external_id, locale, timestamps)
- [ ] `ActorType` enum with anonymous_web, telegram, authenticated
- [ ] Unique constraint on (type, external_id)
- [ ] `query_logs` has `actor_id` column (nullable UUID)
- [ ] Actor resolution middleware resolves/creates actors from X-Actor-Id header
- [ ] Missing/invalid X-Actor-Id → auto-create + return in response header
- [ ] Bot requests create telegram-type actors
- [ ] `request.actorId` available on all non-health requests
- [ ] Per-actor daily rate limits enforced (50 queries, 20 L4, 10 photos)
- [ ] Rate limit fail-closed for anonymous, fail-open for API key auth
- [ ] `actor_id` logged in query_logs
- [ ] last_seen_at updated on each request (fire-and-forget)
- [ ] Unit tests for actor resolver
- [ ] Unit tests for actor rate limiting
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Specs updated

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] E2E tests updated (if applicable)
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [ ] Step 0: `spec-creator` executed, specs updated
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-02 | Ticket created | Steps 0+1+2 combined. Spec and plan derived from ADR-016. Cross-model reviews skipped (ADR-016 reviewed by 3 models in 4 iterations; user granted extended autonomy) |

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

*Ticket created: 2026-04-02*
