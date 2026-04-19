# Contributing to foodXPlorer

## Data seeding

### Standard portion CSV pipeline (F-UX-B)

The `standard_portions` table stores per-dish portion assumptions (grams, pieces, pieceName, confidence) for the 30 priority Spanish dishes. It is seeded offline via an analyst-reviewed CSV pipeline.

**Files:**
- `packages/api/prisma/seed-data/standard-portions.csv` — source of truth (committed to git)
- `packages/api/src/scripts/generateStandardPortionCsv.ts` — offline generator
- `packages/api/src/scripts/seedStandardPortionCsv.ts` — seed runner (with rollback docs)

**Adding new rows:**

1. Run the generator to append template rows for any un-seeded priority dishes:
   ```
   npm run generate:standard-portions -w @foodxplorer/api
   ```
2. Edit the CSV — fill in `grams`, `pieces`, `pieceName`, `confidence` for each row.
3. Set `reviewed_by` to your GitHub username when a row is reviewed.
4. Commit the CSV.
5. Run the seed script to upsert reviewed rows:
   ```
   npm run seed:standard-portions -w @foodxplorer/api
   ```
   Unreviewed rows (`reviewed_by` empty) are silently skipped. Output: `Seeded N rows. Skipped M unreviewed rows.`

**Rollback procedure:**

To un-seed a specific row:
1. `DELETE FROM standard_portions WHERE dish_id = $1 AND term = $2;`
2. Clear `reviewed_by` in the source CSV row (empty the column, keep the row).
3. Re-run the generator to restore the template row as unreviewed.
4. Verify: `SELECT * FROM standard_portions WHERE dish_id = $1;` — should be empty.

For a full table reset (e.g., schema migration):
```sql
TRUNCATE standard_portions CASCADE;
```
Then delete affected CSV rows entirely. WARNING: run in a maintenance window. The seed pipeline does NOT delete rows on its own — it only upserts, so removing a row from the CSV is NOT enough to remove it from the DB.

**Cache note:** The existing cache key does not include a portion-term dimension. A generic-path response cached before seeding could be served stale after a new Tier 1 row is added. Always flush Redis after seeding in production:
```
redis-cli -u $REDIS_URL FLUSHDB
```

## Integration tests — embedding routing (F114+)

Some integration tests verify semantic routing via pgvector cosine similarity against the `dishes.embedding` column. These tests are gated behind env vars because they require seeded data + embedding regeneration (expensive, not suitable for default CI).

**Two tiers of tests:**

- **Tier A (structural)** — verify that F114-affected dishes have non-null embeddings in the test DB, and that F114 data modifications landed correctly (alias removal from Entrecot, alias extension on Arroz blanco). Runs when:
  ```
  ENABLE_EMBEDDING_INTEGRATION_TESTS=true
  ```
- **Tier B (true routing)** — embed a query string at test time (OpenAI call) and assert the top pgvector match is the expected dishId. Fulfils acceptance criteria that require "true routing assertion, not just existence check." Runs when BOTH env vars are set:
  ```
  ENABLE_EMBEDDING_INTEGRATION_TESTS=true
  OPENAI_API_KEY=<valid_key>
  ```

**Prerequisites before running:**

```
DATABASE_URL=<test_db_url> npm run seed -w @foodxplorer/api
DATABASE_URL=<test_db_url> OPENAI_API_KEY=<key> npm run embeddings:generate -w @foodxplorer/api
```

**Example — run F114 routing tests locally:**

```bash
export ENABLE_EMBEDDING_INTEGRATION_TESTS=true
export OPENAI_API_KEY=sk-...
export DATABASE_URL_TEST=postgresql://...
npx vitest run --config packages/api/vitest.config.integration.ts -t "F114"
```

If Tier B tests fail (top match is NOT the expected dishId), investigate:
1. Has the embedding been regenerated AFTER the alias changes on the dish entries?
2. Is there an older alias still present in the JSON that is now a false match?
3. Is the OpenAI embedding model aligned with the one the pipeline uses?

