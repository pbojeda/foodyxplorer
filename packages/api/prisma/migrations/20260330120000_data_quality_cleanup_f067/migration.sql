-- F067: Data quality cleanup — strip leading slashes from dish names
--
-- Some Burger King dish names have leading "/ " from PDF parsing artifacts.
-- Examples: "/ Brownie & Ice Cream", "/ Whopper® Gluten Free"

UPDATE dishes
SET name = regexp_replace(name, '^/\s*', ''),
    name_es = regexp_replace(name_es, '^/\s*', '')
WHERE name LIKE '/%' OR name_es LIKE '/%';

-- ROLLBACK (manual):
-- No safe rollback — original leading-slash names are not preserved.
-- The data quality was already degraded; this migration improves it.
