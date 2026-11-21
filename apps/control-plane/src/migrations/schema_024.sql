-- One durable publication intent per approved isolated restore. Execution stays in the worker.
CREATE TABLE shared_restore_publications (
  approval_id uuid PRIMARY KEY REFERENCES shared_restore_approvals(id),
  control_tenant_id uuid NOT NULL REFERENCES tenants(id),
  runtime_scope text NOT NULL,
  issuer text NOT NULL,
  actor_uid bigint NOT NULL CHECK (actor_uid > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','published','needs_intervention')),
  code text,
  host text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='published') = (host IS NOT NULL))
);
CREATE INDEX shared_restore_publications_pending ON shared_restore_publications(created_at) WHERE status='queued';
