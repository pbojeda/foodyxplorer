-- F-UX-B: Replace legacy standard_portions table with per-dish portion assumption schema.
--
-- Pre-flight safety check (MUST run before any DROP):
--   SELECT COUNT(*) FROM standard_portions;
-- If count > 0, backup via pg_dump before proceeding:
--   pg_dump --table standard_portions $DATABASE_URL > /tmp/standard_portions_backup_$(date +%Y%m%d_%H%M%S).sql
-- Then ABORT the migration until the data is accounted for.
--
-- Note: The legacy table contained only Phase 1/2 seed data (group-level USDA
-- food group portions) which were never referenced at query time. The new schema
-- is fully incompatible with the legacy shape. Data has been backed up to
-- /tmp/standard_portions_backup_*.json before this migration runs.

-- Step 1: Drop the legacy table (cascades orphaned indexes and CHECK constraint)
DROP TABLE IF EXISTS standard_portions CASCADE;

-- Step 2: Drop the legacy PortionContext enum (only used by the dropped column)
DROP TYPE IF EXISTS portion_context;

-- Step 3: Create the new portion_confidence enum
CREATE TYPE portion_confidence AS ENUM ('high', 'medium', 'low');

-- Step 4: Create the new standard_portions table
CREATE TABLE standard_portions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id      UUID        NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  term         VARCHAR(50) NOT NULL,
  grams        INTEGER     NOT NULL CHECK (grams > 0),
  pieces       INTEGER     CHECK (pieces >= 1),
  piece_name   VARCHAR(100),
  confidence   portion_confidence NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Pieces and piece_name must both be null or both non-null
  CONSTRAINT std_portions_pieces_name_pairing
    CHECK ((pieces IS NULL) = (piece_name IS NULL)),

  -- One row per (dish, term) combination
  UNIQUE (dish_id, term)
);

-- Index for FK lookups (covered by the unique constraint, no extra index needed)
