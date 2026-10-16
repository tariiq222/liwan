CREATE TABLE vendor_accounts (
  id bigserial PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+$' AND length(email) <= 254),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'enrolling' CHECK (status IN ('enrolling','active','disabled')),
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE UNIQUE INDEX vendor_accounts_email ON vendor_accounts (email);
CREATE TABLE vendor_account_roles (
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','customer_success','finance','product','operations','support')),
  PRIMARY KEY (account_id, role)
);
CREATE TABLE vendor_passkeys (
  credential_id text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE TABLE vendor_totp (
  account_id bigint PRIMARY KEY REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  secret_box bytea NOT NULL,
  last_step bigint NOT NULL DEFAULT 0,
  confirmed_at timestamptz
);
CREATE TABLE vendor_recovery_codes (
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (account_id, code_hash)
);
CREATE TABLE vendor_sessions (
  token_hash text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  step_up_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX vendor_sessions_account ON vendor_sessions (account_id) WHERE revoked_at IS NULL;
CREATE TABLE vendor_invitations (
  token_hash text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('enroll','reset')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE vendor_auth_challenges (
  id uuid PRIMARY KEY,
  account_id bigint REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('register','login','step_up')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE vendor_auth_attempts (
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  PRIMARY KEY (scope)
);

-- A vendor's authority is computed from vendor_account_roles and vendor_accounts.status; the table that
-- copied it (keyed by Odoo uid) is gone. Rows that recorded an Odoo uid as their actor keep their issuer,
-- which is never the vendor-account issuer, so no grant check can match them to an account.
DROP TABLE vendor_memberships;
