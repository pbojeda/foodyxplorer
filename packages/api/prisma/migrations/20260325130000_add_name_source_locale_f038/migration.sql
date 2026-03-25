ALTER TABLE dishes
  ADD COLUMN name_source_locale VARCHAR(5) NULL;

COMMENT ON COLUMN dishes.name_source_locale IS
  'Detected language of the original name field. Values: en, es, mixed, unknown. NULL = not yet classified.';
