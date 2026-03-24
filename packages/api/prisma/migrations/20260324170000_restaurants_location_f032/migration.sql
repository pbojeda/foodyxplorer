-- F032: Add location fields to restaurants
ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "address"          VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "google_maps_url"  TEXT,
  ADD COLUMN IF NOT EXISTS "latitude"         DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "longitude"        DECIMAL(10,7);
