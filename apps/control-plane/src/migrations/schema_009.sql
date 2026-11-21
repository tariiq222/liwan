-- Identity and public progress only. Credentials stay in private operator files.
CREATE TABLE shared_onboardings (
  request_id uuid PRIMARY KEY,
  control_tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
  issuer text NOT NULL,
  actor_uid bigint NOT NULL CHECK(actor_uid > 0),
  request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
  admin_name text NOT NULL,
  admin_login text NOT NULL,
  host text NOT NULL UNIQUE,
  tenant_slug text NOT NULL UNIQUE,
  database_name text NOT NULL UNIQUE,
  job_id uuid UNIQUE REFERENCES shared_jobs(id),
  job_digest text,
  stage text NOT NULL DEFAULT 'reserved' CHECK(stage IN ('reserved','queued','verifying','activating','active','needs_intervention')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Public registry APIs cannot enable a new real tenant by bypassing readiness.
CREATE FUNCTION shared_onboarding_activation_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.enabled AND EXISTS (SELECT 1 FROM shared_onboardings WHERE control_tenant_id=NEW.control_tenant_id) AND NOT EXISTS (
    SELECT 1 FROM shared_onboardings o JOIN shared_jobs j ON j.id=o.job_id
    WHERE o.control_tenant_id=NEW.control_tenant_id AND o.stage IN ('activating','active')
      AND j.state='verified' AND j.payload_digest=o.job_digest
      AND j.receipt->>'payloadDigest'=o.job_digest
      AND j.payload->'binding'->>'tenantId'=NEW.tenant_id
      AND j.payload->'binding'->>'database'=NEW.database_name
      AND (o.stage='active' OR (j.payload->'binding'->>'registryRevision')::bigint+1=NEW.registry_revision)
  ) THEN RAISE EXCEPTION 'shared onboarding readiness required'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_onboarding_route_gate BEFORE INSERT OR UPDATE ON shared_registry_bindings
  FOR EACH ROW EXECUTE FUNCTION shared_onboarding_activation_gate();
