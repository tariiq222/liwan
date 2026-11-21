-- Registry authority is distinct from its read-only published routing snapshot.
CREATE TABLE shared_registry_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision < 9007199254740991)
);
INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0);
CREATE TABLE shared_registry_bindings (
  control_tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  tenant_id text NOT NULL UNIQUE CHECK (tenant_id ~ '^[a-z][a-z0-9_-]{0,62}$'),
  host text NOT NULL UNIQUE,
  database_name text NOT NULL UNIQUE CHECK (database_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  filestore text NOT NULL UNIQUE CHECK (filestore = database_name),
  enabled boolean NOT NULL,
  registry_revision bigint NOT NULL CHECK (registry_revision > 0 AND registry_revision < 9007199254740991)
);
CREATE TABLE shared_registry_hosts (
  host text PRIMARY KEY,
  control_tenant_id uuid NOT NULL REFERENCES shared_registry_bindings(control_tenant_id)
);
CREATE TABLE shared_registry_audit (
  snapshot_revision bigint PRIMARY KEY,
  control_tenant_id uuid NOT NULL REFERENCES shared_registry_bindings(control_tenant_id),
  actor_uid bigint NOT NULL CHECK (actor_uid > 0),
  issuer text NOT NULL,
  reason text NOT NULL,
  before_target jsonb,
  after_target jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION shared_registry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'registry identities are permanent'; END IF;
  IF NEW.control_tenant_id IS DISTINCT FROM OLD.control_tenant_id OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.database_name IS DISTINCT FROM OLD.database_name OR
     NEW.filestore IS DISTINCT FROM OLD.filestore OR
     NEW.registry_revision <> OLD.registry_revision + 1 THEN
    RAISE EXCEPTION 'registry identity or revision is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_registry_identity BEFORE UPDATE OR DELETE ON shared_registry_bindings
  FOR EACH ROW EXECUTE FUNCTION shared_registry_immutable();
CREATE FUNCTION shared_registry_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'registry history is append only'; END; $$;
CREATE TRIGGER shared_registry_host_history BEFORE UPDATE OR DELETE ON shared_registry_hosts
  FOR EACH ROW EXECUTE FUNCTION shared_registry_append_only();
CREATE TRIGGER shared_registry_audit_history BEFORE UPDATE OR DELETE ON shared_registry_audit
  FOR EACH ROW EXECUTE FUNCTION shared_registry_append_only();
