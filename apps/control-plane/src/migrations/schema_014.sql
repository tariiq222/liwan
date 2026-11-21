-- Commercial setup flag on customers. Requires schema_012 and schema_013.
-- Registered as migration 14 in db.ts.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS commercial_setup_required boolean NOT NULL DEFAULT false;
