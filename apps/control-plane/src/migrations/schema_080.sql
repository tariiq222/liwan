-- Self-signup picks its workspace host: the chosen slug is held at completion, active once the workspace exists, and
-- retired for good when the workspace is deleted. A retired slug is never reused.
CREATE TABLE workspace_slugs (
  slug text PRIMARY KEY,
  customer_id uuid REFERENCES customers(id),
  state text NOT NULL CHECK (state IN ('held','active','retired')),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_slugs_customer_idx ON workspace_slugs(customer_id);

-- Hosts that already exist keep their label, so no new workspace can take it.
INSERT INTO workspace_slugs(slug, customer_id, state)
  SELECT split_part(b.host, '.', 1), c.id, CASE WHEN b.retired THEN 'retired' ELSE 'active' END
  FROM shared_registry_bindings b LEFT JOIN customers c ON c.tenant_id = b.control_tenant_id
  ON CONFLICT DO NOTHING;

-- An open signup carries the slug and both channel proofs; the handoff secret is stored only as its HMAC.
DELETE FROM public_signups;
ALTER TABLE public_signups
  ADD COLUMN slug text NOT NULL,
  ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN handoff_digest bytea,
  ADD COLUMN handoff_expires_at timestamptz;
