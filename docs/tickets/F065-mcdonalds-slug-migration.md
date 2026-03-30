# F065: McDonald's Chain Slug Migration (`mcdonalds` → `mcdonalds-es` / `mcdonalds-pt`)

**Feature:** F065 | **Type:** Bug (data integrity) | **Priority:** High
**Status:** Backlog | **Branch:** —
**Created:** 2026-03-30 | **Dependencies:** None
**Audit Source:** Comprehensive Validation Phase 2 — API real testing, confirmed by Gemini 2.5 Pro

---

## Spec

### Description

The McDonald's chain slug is `mcdonalds` for both Spain and Portugal, violating the naming convention used by all other chains (`burger-king-es`, `kfc-es`, `telepizza-es`, etc.) and causing:

1. **Data ambiguity:** Two chains share the same slug. Any query filtering by `chainSlug=mcdonalds` returns results from both countries.
2. **Manual examples broken:** The bot user manual uses `mcdonalds-es` in all examples (sections 2, 4, 7, 8, 9, 15), but this slug does not exist — queries with `chainSlug=mcdonalds-es` return `result: null`.
3. **Bot chain resolver mismatch:** The 4-tier chain resolver may resolve "mcdonalds" to the wrong country entry depending on DB ordering.

### Current State (dev DB)

| chainSlug | name | countryCode | dishCount |
|-----------|------|:-----------:|:---------:|
| `mcdonalds` | McDonald's Spain | ES | 2 |
| `mcdonalds` | McDonald's Portugal | PT | 0 |

### Target State

| chainSlug | name | countryCode | dishCount |
|-----------|------|:-----------:|:---------:|
| `mcdonalds-es` | McDonald's Spain | ES | 2 |
| `mcdonalds-pt` | McDonald's Portugal | PT | 0 |

### Impact Analysis

- **restaurants table:** `chain_slug` column on all McDonald's restaurants
- **dishes table:** `chain_slug` column on all McDonald's dishes (2 in dev)
- **dish_nutrients:** No direct impact (linked via dish_id)
- **data_sources:** Check for `chain_slug` references
- **query_logs:** Historical logs reference `mcdonalds` — leave as-is (historical data)
- **Redis cache:** Invalidate all `estimate:*` and `chains:*` cache keys after migration
- **Bot user manual:** Update all `mcdonalds-es` examples (they become correct post-migration)
- **chain-pdf-registry:** Check for `mcdonalds` slug references in scraper config

### Acceptance Criteria

- [ ] `mcdonalds` slug no longer exists in `restaurants` or `dishes` tables
- [ ] `mcdonalds-es` resolves correctly for all Spain McDonald's data
- [ ] `mcdonalds-pt` resolves correctly for Portugal data
- [ ] `/estimate?query=big+mac&chainSlug=mcdonalds-es` returns Big Mac (not null)
- [ ] `/chains?isActive=true` shows two distinct slugs
- [ ] Bot chain resolver finds "mcdonalds" → resolves to `mcdonalds-es` (Spain, has data)
- [ ] Redis cache invalidated post-migration
- [ ] UNIQUE constraint on `(chain_slug, country_code)` or equivalent to prevent recurrence

---

## Implementation Plan

### Step 1: Prisma Migration

Create a new Prisma migration with a SQL data migration:

```sql
-- 1. Update restaurants
UPDATE restaurants SET chain_slug = 'mcdonalds-es' WHERE chain_slug = 'mcdonalds' AND country_code = 'ES';
UPDATE restaurants SET chain_slug = 'mcdonalds-pt' WHERE chain_slug = 'mcdonalds' AND country_code = 'PT';

-- 2. Update dishes (linked via restaurant, but chain_slug is denormalized)
UPDATE dishes SET chain_slug = 'mcdonalds-es'
  WHERE chain_slug = 'mcdonalds'
    AND restaurant_id IN (SELECT id FROM restaurants WHERE country_code = 'ES');

UPDATE dishes SET chain_slug = 'mcdonalds-pt'
  WHERE chain_slug = 'mcdonalds'
    AND restaurant_id IN (SELECT id FROM restaurants WHERE country_code = 'PT');

-- 3. Update data_sources if chain_slug exists
UPDATE data_sources SET chain_slug = 'mcdonalds-es' WHERE chain_slug = 'mcdonalds' AND name ILIKE '%spain%';
UPDATE data_sources SET chain_slug = 'mcdonalds-pt' WHERE chain_slug = 'mcdonalds' AND name ILIKE '%portugal%';

-- 4. Verify no orphaned mcdonalds slugs remain
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM restaurants WHERE chain_slug = 'mcdonalds') THEN
    RAISE EXCEPTION 'Migration incomplete: mcdonalds slug still exists in restaurants';
  END IF;
  IF EXISTS (SELECT 1 FROM dishes WHERE chain_slug = 'mcdonalds') THEN
    RAISE EXCEPTION 'Migration incomplete: mcdonalds slug still exists in dishes';
  END IF;
END $$;
```

### Step 2: Update Seed Data

Update seed scripts that reference `mcdonalds` slug:
- `packages/api/prisma/seed*.ts` files
- `packages/scraper/src/config/` chain registry files

### Step 3: Update Bot Manual

The manual already uses `mcdonalds-es` — this migration makes those examples correct. No manual changes needed for this ticket (handled separately in F057-style batch).

### Step 4: Cache Invalidation

After migration, clear Redis cache:
```bash
redis-cli -p 6380 KEYS "fxp:estimate:*" | xargs redis-cli -p 6380 DEL
redis-cli -p 6380 KEYS "fxp:chains:*" | xargs redis-cli -p 6380 DEL
```

### Step 5: Verification

Run against dev API after migration:
```bash
curl -s "https://api-dev.nutrixplorer.com/estimate?query=big+mac&chainSlug=mcdonalds-es"
# Expected: result != null, chainSlug = mcdonalds-es

curl -s "https://api-dev.nutrixplorer.com/chains?isActive=true" | jq '.data[] | select(.chainSlug | startswith("mcdonalds"))'
# Expected: mcdonalds-es (ES), mcdonalds-pt (PT)
```

---

## Test Plan

- [ ] Migration applies cleanly on dev
- [ ] No `mcdonalds` slugs remain in restaurants/dishes/data_sources
- [ ] `/estimate?chainSlug=mcdonalds-es` returns results
- [ ] `/chains` shows separate mcdonalds-es and mcdonalds-pt entries
- [ ] Bot `/cadenas` shows correct slugs
- [ ] Bot `/estimar big mac en mcdonalds-es` works
- [ ] Existing unit tests pass (update mocks if needed)
- [ ] Cache invalidated and rebuilt correctly

---

## Merge Checklist Evidence

| Check | Evidence |
|-------|----------|
| Tests pass | |
| Migration reversible | |
| Manual updated | N/A (already uses mcdonalds-es) |
| Cache invalidated | |
