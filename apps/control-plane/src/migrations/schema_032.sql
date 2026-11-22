-- The vendor's choice of the platform AI provider (spec 2026-11-04 §6.13): one row. The key is sealed with the control
-- plane's admin secret (admin-auth/crypto.ts) and never read back out by any route; last4 is all that is shown.
-- `revision` is the revision written into the file the AI service reads, so the file and this row can be compared.
CREATE TABLE ai_platform_provider (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  preset text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('anthropic','openai','ollama','openrouter','openai_compatible')),
  model text NOT NULL,
  base_url text,
  stream_usage boolean NOT NULL,
  api_key_sealed bytea,
  api_key_last4 text CHECK (api_key_last4 ~ '^.{4}$'),
  revision integer NOT NULL CHECK (revision >= 1),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((api_key_sealed IS NULL) = (api_key_last4 IS NULL))
);
