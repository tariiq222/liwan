-- B4 branches, usage snapshots, fulfillment effects.
-- Registered in db.ts as version 15; depends on schema_013 (+014).
CREATE TABLE branch_quote_requests (
  quote_id uuid PRIMARY KEY REFERENCES commercial_quotes(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  adds jsonb NOT NULL, archive jsonb NOT NULL,
  quoted_paid integer NOT NULL CHECK(quoted_paid>=0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER branch_quote_requests_guard BEFORE UPDATE OR DELETE ON branch_quote_requests FOR EACH ROW EXECUTE FUNCTION commercial_immutable();
CREATE TABLE commercial_branches (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  tenant_id uuid REFERENCES tenants(id),
  name text NOT NULL CHECK(length(btrim(name)) > 0),
  kind text NOT NULL CHECK(kind IN ('hq','extra')),
  billing text NOT NULL CHECK(billing IN ('included','free_extra','paid')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','archived','failed')),
  odoo_company_id integer,
  order_id uuid REFERENCES orders(id),
  operation_id text,
  activated_at timestamptz, archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(kind<>'hq' OR billing='included')
);
CREATE UNIQUE INDEX commercial_branches_one_hq ON commercial_branches(subscription_id) WHERE kind='hq';
CREATE UNIQUE INDEX commercial_branches_name ON commercial_branches(subscription_id, lower(name)) WHERE state<>'archived';
CREATE UNIQUE INDEX commercial_branches_company ON commercial_branches(tenant_id, odoo_company_id) WHERE odoo_company_id IS NOT NULL;
CREATE INDEX commercial_branches_sub_idx ON commercial_branches(subscription_id, state);
CREATE FUNCTION commercial_branch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'branch_never_deleted'; END IF;
  IF OLD.state='archived' AND NEW.state<>'archived' THEN RAISE EXCEPTION 'branch_archived_immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.subscription_id<>OLD.subscription_id OR NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'branch_identity_immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commercial_branch_guard BEFORE UPDATE OR DELETE ON commercial_branches FOR EACH ROW EXECUTE FUNCTION commercial_branch_guard();

CREATE TABLE usage_snapshots (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  freshness text NOT NULL CHECK(freshness IN ('fresh','stale','unavailable')),
  metrics jsonb, source text NOT NULL,
  CHECK(freshness='unavailable' OR metrics IS NOT NULL)
);
CREATE INDEX usage_snapshots_tenant_idx ON usage_snapshots(tenant_id, observed_at DESC);

CREATE TABLE fulfillment_effects (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  job_id uuid, operation_id text NOT NULL,
  receipt jsonb, observed_digest text, applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
