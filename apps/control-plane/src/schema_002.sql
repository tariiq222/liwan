ALTER TABLE tenants ADD COLUMN IF NOT EXISTS catalog_tier text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS policy_revision integer;
