CREATE TABLE IF NOT EXISTS vendor_memberships (
  issuer text NOT NULL,
  actor_uid bigint NOT NULL CHECK (actor_uid > 0),
  capabilities text[] NOT NULL DEFAULT '{}',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, actor_uid)
);
CREATE TABLE IF NOT EXISTS service_nonces (
  issuer text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (issuer, nonce)
);
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  commercial_mode text NOT NULL CHECK (commercial_mode IN ('saas','non_saas')),
  hosting_model text NOT NULL CHECK (hosting_model IN ('managed','customer_hosted')),
  inventory_target text NOT NULL UNIQUE,
  catalog_version text,
  catalog_tier text,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','provisioning','active','needs_intervention')),
  desired_policy jsonb,
  observed_policy jsonb,
  policy_revision integer,
  health_checked_at timestamptz,
  operations_enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_entries (
  id uuid PRIMARY KEY,
  version text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','published')),
  solution jsonb NOT NULL,
  source_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_uid bigint NOT NULL,
  issuer text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','needs_intervention')),
  stage text NOT NULL DEFAULT 'queued',
  request_id uuid NOT NULL,
  reason text NOT NULL,
  payload jsonb NOT NULL,
  payload_digest text NOT NULL,
  result jsonb,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_uid, issuer, tenant_id, request_id)
);
CREATE INDEX IF NOT EXISTS operations_queue ON operations(created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS operations_tenant ON operations(tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS operation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES operations(id),
  stage text NOT NULL,
  status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS restore_approvals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  backup_id text NOT NULL,
  action text NOT NULL CHECK (action = 'restore'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid REFERENCES operations(id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  subject text NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created ON audit_events(created_at DESC);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS catalog_tier text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS policy_revision integer;

CREATE OR REPLACE FUNCTION prevent_published_catalog_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' AND (NEW.solution IS DISTINCT FROM OLD.solution OR NEW.version IS DISTINCT FROM OLD.version OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'published catalog is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS catalog_immutable ON catalog_entries;
CREATE TRIGGER catalog_immutable BEFORE UPDATE ON catalog_entries FOR EACH ROW EXECUTE FUNCTION prevent_published_catalog_change();
