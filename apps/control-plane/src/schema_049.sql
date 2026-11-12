-- Removes the remnants of the deleted legacy -> SaaS commercial migration for databases that applied version 14 earlier.
DROP TABLE IF EXISTS legacy_mappings;
DROP TABLE IF EXISTS migration_runs;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS legacy_source;
