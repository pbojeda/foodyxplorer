-- BUG-PROD-009: Remap wrong dishIds in standard_portions
--
-- Pre-condition: take a fresh backup before running:
--   pg_dump $DATABASE_URL -t standard_portions > ~/standard_portions_backup_pre_BUG-PROD-009_$(date +%Y%m%d).sql
--
-- Then run this script:
--   psql $DATABASE_URL -f packages/api/src/scripts/migrations/BUG-PROD-009-remap-dishids.sql
--
-- Post-migration verify:
--   SELECT dish_id, term, grams FROM standard_portions
--     WHERE dish_id IN (
--       '00000000-0000-e073-0007-000000000015',  -- Bocadillo de jamón york (ghost)
--       '00000000-0000-e073-0007-000000000007',  -- Pincho de tortilla (ghost)
--       '00000000-0000-e073-0007-000000000069',  -- Entrecot de ternera (chuletón ghost)
--       '00000000-0000-e073-0007-000000000084'   -- Arroz negro (arroz ghost)
--     );
--   -- expected: 0 rows post-DELETE
--
--   SELECT dish_id, term, grams FROM standard_portions
--     WHERE dish_id IN (
--       '00000000-0000-e073-0007-000000000022',  -- Jamón ibérico (correct)
--       '00000000-0000-e073-0007-00000000001c',  -- Tortilla de patatas (correct)
--       '00000000-0000-e073-0007-000000000046'   -- Cocido madrileño (correct)
--     )
--   ORDER BY dish_id, term;
--   -- expected: 4 rows per dishId (pintxo, tapa, media_racion, racion) after seed
--
-- Idempotency: Running this DELETE twice is safe (the second run finds 0 rows matching).
-- Running the seed twice is safe (UPSERT semantics).
--
-- Prod concurrency note (Codex P1 finding): the DELETE+seed sequence is NOT atomic
-- across this transaction and the npm seed script. Between DELETE commit and seed
-- completion (~2-5 seconds), queries briefly hit Tier 3 fallback. Run in a low-traffic
-- window (early morning Madrid time).

-- Pre-flight identity check (QA M3 — BUG-PROD-009): prints the current database
-- name and row count so the operator confirms they are connected to the intended
-- environment before any DELETE runs. Abort the psql session (Ctrl-C) if the
-- output doesn't match expectations.
\echo '==> BUG-PROD-009 migration pre-flight check'
SELECT current_database() AS db_name,
       current_user       AS db_user,
       inet_server_addr() AS db_host,
       (SELECT COUNT(*) FROM standard_portions) AS standard_portions_rowcount_before;

BEGIN;

-- Remove all rows at dishIds the new PRIORITY_DISH_MAP no longer targets.
-- The re-seed (run immediately after COMMIT) will INSERT new correct rows
-- for dishIds the new map DOES target (...0022, ...001c, ...0046) and will
-- UPSERT existing rows at correct dishIds (...0044 lentejas, ...0049 ensalada, etc.).
DELETE FROM standard_portions
  WHERE dish_id IN (
    '00000000-0000-e073-0007-000000000015'::uuid,  -- Bocadillo de jamón york (labeled "jamón"/"cocido"/"bocadillo" templates)
    '00000000-0000-e073-0007-000000000007'::uuid,  -- Pincho de tortilla (labeled "tortilla" templates)
    '00000000-0000-e073-0007-000000000069'::uuid,  -- Entrecot de ternera (labeled "chuletón" templates — chuletón omitted in new map, see F114)
    '00000000-0000-e073-0007-000000000084'::uuid   -- Arroz negro (labeled "arroz" templates — arroz omitted in new map, see F114)
  );

COMMIT;

-- NEXT STEP (run AFTER this transaction commits):
--   npm run seed:standard-portions -w @foodxplorer/api
-- The seed pipeline uses UPSERT by (dish_id, term), so:
--   - INSERTs new rows for ...0022 (jamón ibérico), ...001c (tortilla de patatas), ...0046 (cocido madrileño)
--   - UPSERTs existing rows at ...0044, ...0049, ...0045, ...004b, ...004e, ...00ae (refreshes values)
--   - Leaves other dishIds untouched
