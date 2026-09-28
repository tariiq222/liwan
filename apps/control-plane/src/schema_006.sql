-- Separate shared queue: legacy dedicated workers cannot claim these rows.
CREATE TABLE shared_jobs (
 id uuid PRIMARY KEY,
 control_tenant_id uuid NOT NULL REFERENCES shared_registry_bindings(control_tenant_id),
 business_key text NOT NULL,
 payload jsonb NOT NULL,
 payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
 issuer text NOT NULL,
 actor_uid bigint NOT NULL CHECK(actor_uid > 0),
 reason text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','verified','needs_intervention')),
 attempt_id uuid,
 fence bigint NOT NULL DEFAULT 0 CHECK(fence >= 0),
 lease_until timestamptz,
 journal jsonb,
 receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(control_tenant_id,business_key)
);
CREATE UNIQUE INDEX shared_jobs_one_running ON shared_jobs(control_tenant_id) WHERE state='running';
CREATE TABLE shared_job_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES shared_jobs(id),
 attempt_id uuid NOT NULL,
 fence bigint NOT NULL,
 sequence bigint NOT NULL,
 stage text NOT NULL CHECK(stage IN ('prepared','started','verified','needs_intervention')),
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(job_id,sequence)
);
CREATE FUNCTION shared_job_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'shared jobs are permanent'; END IF;
 IF OLD.state='verified' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'verified receipt is immutable'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.control_tenant_id IS DISTINCT FROM OLD.control_tenant_id OR
 NEW.business_key IS DISTINCT FROM OLD.business_key OR NEW.payload IS DISTINCT FROM OLD.payload OR
 NEW.payload_digest IS DISTINCT FROM OLD.payload_digest OR NEW.issuer IS DISTINCT FROM OLD.issuer OR
 NEW.actor_uid IS DISTINCT FROM OLD.actor_uid OR NEW.fence < OLD.fence THEN
 RAISE EXCEPTION 'shared job identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_job_identity BEFORE UPDATE OR DELETE ON shared_jobs FOR EACH ROW EXECUTE FUNCTION shared_job_identity_immutable();
CREATE FUNCTION shared_job_event_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_job shared_jobs%ROWTYPE;
BEGIN
 SELECT * INTO current_job FROM shared_jobs WHERE id=NEW.job_id FOR UPDATE;
 IF NOT FOUND OR NEW.attempt_id IS DISTINCT FROM current_job.attempt_id OR
    NEW.fence <> current_job.fence OR
    NEW.sequence <> COALESCE((current_job.journal->>'sequence')::bigint,0)+1 THEN
   RAISE EXCEPTION 'shared event ownership mismatch';
 END IF;
 IF current_job.state='running' THEN
   IF current_job.lease_until IS NULL OR current_job.lease_until<=clock_timestamp() THEN
     RAISE EXCEPTION 'shared lease expired';
   END IF;
 ELSIF NOT (current_job.state='needs_intervention' AND NEW.stage='verified') THEN
   RAISE EXCEPTION 'shared event state mismatch';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_job_event_fence BEFORE INSERT ON shared_job_events FOR EACH ROW EXECUTE FUNCTION shared_job_event_owner();
CREATE TRIGGER shared_job_events_immutable BEFORE UPDATE OR DELETE ON shared_job_events FOR EACH ROW EXECUTE FUNCTION shared_registry_append_only();
