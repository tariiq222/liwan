CREATE TABLE public_signups (
  id uuid PRIMARY KEY,
  company_name text NOT NULL,
  admin_name text NOT NULL,
  email text NOT NULL,
  mobile text NOT NULL,
  expires_at timestamptz NOT NULL,
  sms_digest bytea NOT NULL,
  sms_expires_at timestamptz NOT NULL,
  sms_attempts integer NOT NULL DEFAULT 0 CHECK(sms_attempts BETWEEN 0 AND 5),
  mobile_verified boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false,

  email_digest bytea,
  email_expires_at timestamptz,
  email_attempts integer NOT NULL DEFAULT 0 CHECK(email_attempts BETWEEN 0 AND 5),
  CHECK ((email_digest IS NULL) = (email_expires_at IS NULL))
);
CREATE INDEX public_signups_expiry_idx ON public_signups(expires_at);

-- Stable claims survive cleanup of challenges and later changes to a customer's administrator.
CREATE TABLE public_signup_trials (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) DEFERRABLE INITIALLY DEFERRED,
  email text NOT NULL UNIQUE,
  mobile text NOT NULL UNIQUE
);

CREATE TABLE public_signup_deliveries (
  channel text NOT NULL CHECK(channel IN ('sms','email')),
  destination_key text NOT NULL,
  source_key text NOT NULL,
  issued_at timestamptz NOT NULL
);
CREATE INDEX public_signup_deliveries_time_idx ON public_signup_deliveries(issued_at);
