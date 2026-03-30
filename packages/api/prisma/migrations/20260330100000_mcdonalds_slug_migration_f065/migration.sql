-- F065: McDonald's chain slug migration (mcdonalds → mcdonalds-es / mcdonalds-pt)
--
-- All other chains already follow the {brand}-{country} convention (e.g. burger-king-es).
-- McDonald's was the only chain using a bare slug without country suffix.
--
-- Only the restaurants table has chain_slug as a real column.
-- The dishes and data_sources tables expose chainSlug via JOINs in the API layer.

-- 1. Update restaurants
UPDATE restaurants SET chain_slug = 'mcdonalds-es' WHERE chain_slug = 'mcdonalds' AND country_code = 'ES';
UPDATE restaurants SET chain_slug = 'mcdonalds-pt' WHERE chain_slug = 'mcdonalds' AND country_code = 'PT';

-- 2. Safety check: no orphaned mcdonalds slugs should remain
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM restaurants WHERE chain_slug = 'mcdonalds') THEN
    RAISE EXCEPTION 'Migration incomplete: mcdonalds slug still exists in restaurants';
  END IF;
END $$;

-- ROLLBACK (manual):
-- UPDATE restaurants SET chain_slug = 'mcdonalds' WHERE chain_slug = 'mcdonalds-es' AND country_code = 'ES';
-- UPDATE restaurants SET chain_slug = 'mcdonalds' WHERE chain_slug = 'mcdonalds-pt' AND country_code = 'PT';
