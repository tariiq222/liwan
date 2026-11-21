-- Phase 3b: when usage collection last tried each tenant (success or not), so a tenant that always fails
-- cannot hold the head of the queue and starve the others.
CREATE TABLE IF NOT EXISTS usage_collection_attempts(
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL
);
