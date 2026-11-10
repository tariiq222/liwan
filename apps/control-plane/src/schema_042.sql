-- The platform AI configuration (specs 2026-11-04 §6.13, 2026-11-10 §5.5): several providers, a list of priced models, one
-- margin, and a map from quality level and capability to model. It replaces the single row of ai_platform_provider (schema_032).
-- Keys are sealed with the control plane's admin secret (admin-auth/crypto.ts) and never read back out by any route; last4 is all
-- that is shown. `revision` is the revision written into the file the AI service reads, so the file and these rows can be compared.
CREATE TABLE ai_provider_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision integer NOT NULL CHECK (revision >= 1),
  margin_bps integer NOT NULL CHECK (margin_bps BETWEEN 0 AND 10000),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_provider (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  preset text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('anthropic','openai','ollama','openrouter','openai_compatible')),
  base_url text,
  stream_usage boolean NOT NULL,
  api_key_sealed bytea,
  api_key_last4 text CHECK (api_key_last4 ~ '^.{4}$'),
  CHECK ((api_key_sealed IS NULL) = (api_key_last4 IS NULL))
);

-- Prices are USD per million tokens; 21474.83647 is the largest one that is still a whole number of cost units (one unit is
-- 0.00001 USD) within the shared maximum. `usage_reported` is what the last successful test of this model on its provider saw.
CREATE TABLE ai_model (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  provider_id text NOT NULL REFERENCES ai_provider(id),
  model text NOT NULL,
  input_price numeric(10,5) CHECK (input_price BETWEEN 0 AND 21474.83647),
  cached_input_price numeric(10,5) CHECK (cached_input_price BETWEEN 0 AND 21474.83647),
  output_price numeric(10,5) CHECK (output_price BETWEEN 0 AND 21474.83647),
  usage_reported boolean NOT NULL DEFAULT false
);

-- The default model is the row ('default', 'default'), like `routes.default` beside the quality levels in the file.
CREATE TABLE ai_route (
  quality text NOT NULL CHECK (quality IN ('default','economical','balanced','best')),
  capability text NOT NULL CHECK (capability IN ('default','quick','standard','analysis','writing')),
  model_id text NOT NULL REFERENCES ai_model(id),
  PRIMARY KEY (quality, capability),
  CHECK ((quality = 'default') = (capability = 'default'))
);

-- An existing single provider becomes provider "main" with model "main" on the default route and a zero margin. The model is
-- unpriced and untested, so the vendor prices it and tests it again before it can be routed in a later save.
INSERT INTO ai_provider_config(revision, margin_bps, updated_by, updated_at)
  SELECT revision, 0, updated_by, updated_at FROM ai_platform_provider;
INSERT INTO ai_provider(id, preset, provider, base_url, stream_usage, api_key_sealed, api_key_last4)
  SELECT 'main', preset, provider, base_url, stream_usage, api_key_sealed, api_key_last4 FROM ai_platform_provider;
INSERT INTO ai_model(id, provider_id, model) SELECT 'main', 'main', model FROM ai_platform_provider;
INSERT INTO ai_route(quality, capability, model_id) SELECT 'default', 'default', 'main' FROM ai_platform_provider;

DROP TABLE ai_platform_provider;
