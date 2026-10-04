-- B3 admin invitations: short-lived, single-use, token stored only as sha256 hash.
CREATE TABLE admin_invitations (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  admin_login text NOT NULL CHECK(length(admin_login) > 0),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  sent_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'queued' CHECK(delivery_status IN ('queued','sent','failed','local_capture')),
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_invitations_one_active_idx ON admin_invitations(tenant_id, admin_login)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX admin_invitations_customer_idx ON admin_invitations(customer_id, created_at DESC);
