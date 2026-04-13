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
