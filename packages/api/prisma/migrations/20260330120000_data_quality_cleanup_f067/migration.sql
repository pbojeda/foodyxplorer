-- F067: Data quality cleanup — strip leading slashes from dish names
--
-- Some Burger King dish names have leading "/ " from PDF parsing artifacts.
-- Examples: "/ Brownie & Ice Cream", "/ Whopper® Gluten Free"

UPDATE dishes
SET name = LTRIM(name, '/ '),
    name_es = LTRIM(name_es, '/ ')
WHERE name LIKE '/%' OR name_es LIKE '/%';

-- ROLLBACK (manual):
-- No safe rollback — original leading-slash names are not preserved.
-- The data quality was already degraded; this migration improves it.
