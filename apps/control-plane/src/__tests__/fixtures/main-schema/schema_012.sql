CREATE TABLE catalog_releases (
  id uuid PRIMARY KEY,
  catalog_version text NOT NULL UNIQUE REFERENCES catalog_entries(version),
  applications jsonb NOT NULL, base_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_digest text NOT NULL, artifact_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_catalog_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'catalog_release_immutable'; END $$;
CREATE TRIGGER catalog_release_guard BEFORE UPDATE OR DELETE ON catalog_releases FOR EACH ROW EXECUTE FUNCTION protect_catalog_release();

CREATE TABLE pricing_policy_revisions (
  id uuid PRIMARY KEY,
  timezone text NOT NULL CHECK(timezone='Asia/Riyadh'),
  rounding text NOT NULL CHECK(rounding='half_up_per_line'),
  tax_kind text NOT NULL CHECK(tax_kind IN ('vat_exclusive','none')),
  tax_rate_bps integer, currency text NOT NULL,
  status text NOT NULL DEFAULT 'approved' CHECK(status='approved'),
  approval_note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((tax_kind='vat_exclusive' AND tax_rate_bps=1500) OR (tax_kind='none' AND tax_rate_bps IS NULL))
);
INSERT INTO pricing_policy_revisions(id,timezone,rounding,tax_kind,tax_rate_bps,currency,approval_note)
VALUES('6f1c3d8e-0000-4000-8000-000000000001','Asia/Riyadh','half_up_per_line','vat_exclusive',1500,'SAR','owner decision 2026-10-02');
CREATE FUNCTION protect_pricing_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'pricing_policy_immutable'; END $$;
CREATE TRIGGER pricing_policy_guard BEFORE UPDATE OR DELETE ON pricing_policy_revisions FOR EACH ROW EXECUTE FUNCTION protect_pricing_policy();

CREATE TABLE commercial_bundles (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  next_version integer NOT NULL DEFAULT 2 CHECK(next_version > 1)
);
CREATE TABLE bundle_revisions (
  id uuid PRIMARY KEY,
  bundle_id uuid NOT NULL REFERENCES commercial_bundles(id),
  version integer NOT NULL CHECK(version > 0),
  edit_revision integer NOT NULL DEFAULT 1 CHECK(edit_revision > 0),
  name text NOT NULL, description text NOT NULL,
  audience jsonb NOT NULL, audience_customer_id text,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','published')),
  available boolean NOT NULL DEFAULT false,
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases(id),
  selections jsonb NOT NULL, domain_limits jsonb NOT NULL, prices jsonb NOT NULL,
  content_digest text NOT NULL, validated_digest text,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  UNIQUE(bundle_id,version),
  CHECK(NOT available OR status='published'),
  CHECK((status='published') = (published_at IS NOT NULL) OR status<>'published'),
  CHECK(status='draft' OR (validated_digest IS NOT NULL AND validated_digest=content_digest))
);
CREATE INDEX bundle_revisions_name_idx ON bundle_revisions(lower(name));
CREATE INDEX bundle_revisions_status_idx ON bundle_revisions(status);

CREATE TABLE commercial_plans (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  next_version integer NOT NULL DEFAULT 2 CHECK(next_version > 1)
);
CREATE TABLE plan_revisions (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES commercial_plans(id),
  version integer NOT NULL CHECK(version > 0),
  edit_revision integer NOT NULL DEFAULT 1 CHECK(edit_revision > 0),
  name text NOT NULL,
  audience jsonb NOT NULL, audience_customer_id text,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','published')),
  available boolean NOT NULL DEFAULT false,
  term_months integer NOT NULL CHECK(term_months > 0),
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  prices jsonb NOT NULL, platform_limits jsonb NOT NULL,
  included_bundle_revision_ids jsonb NOT NULL, optional_bundle_revision_ids jsonb NOT NULL,
  included_extra_branches integer NOT NULL CHECK(included_extra_branches >= 0),
  extra_branch_prices jsonb NOT NULL, extra_branches_limit integer CHECK(extra_branches_limit IS NULL OR extra_branches_limit >= 0),
  policy_revision_id uuid NOT NULL REFERENCES pricing_policy_revisions(id),
  trial_days integer NOT NULL CHECK(trial_days >= 0), grace_days integer NOT NULL CHECK(grace_days >= 0),
  auto_suspend boolean NOT NULL, auto_renew_allowed boolean NOT NULL,
  content_digest text NOT NULL, validated_digest text,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  UNIQUE(plan_id,version),
  CHECK(NOT available OR status='published'),
  CHECK(status='draft' OR (validated_digest IS NOT NULL AND validated_digest=content_digest))
);
CREATE INDEX plan_revisions_name_idx ON plan_revisions(lower(name));
CREATE INDEX plan_revisions_status_idx ON plan_revisions(status);

CREATE TABLE revision_references (
  revision_id uuid NOT NULL, revision_kind text NOT NULL CHECK(revision_kind IN ('bundle','plan')),
  referenced_by_kind text NOT NULL, referenced_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(revision_id, referenced_by_kind, referenced_by_id)
);

CREATE TABLE commercial_quotes (
  id uuid PRIMARY KEY, customer_id text NOT NULL, payload jsonb NOT NULL, digest text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_commercial_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'quote_immutable'; END $$;
CREATE TRIGGER commercial_quote_guard BEFORE UPDATE OR DELETE ON commercial_quotes FOR EACH ROW EXECUTE FUNCTION protect_commercial_quote();

CREATE FUNCTION protect_commercial_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refs integer;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' THEN RAISE EXCEPTION 'commercial_delete_forbidden'; END IF;
    SELECT count(*) INTO refs FROM revision_references WHERE revision_id=OLD.id;
    IF refs>0 THEN RAISE EXCEPTION 'commercial_delete_forbidden'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.id<>OLD.id OR NEW.version<>OLD.version OR NEW.created_at<>OLD.created_at
    OR to_jsonb(NEW)->>TG_ARGV[0] IS DISTINCT FROM to_jsonb(OLD)->>TG_ARGV[0] THEN
    RAISE EXCEPTION 'commercial_identity_immutable';
  END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='validated') OR (OLD.status='validated' AND NEW.status IN ('draft','published'))) THEN
    RAISE EXCEPTION 'commercial_transition_invalid';
  END IF;
  IF OLD.status='published' AND (to_jsonb(NEW)-'available'-'edit_revision') IS DISTINCT FROM (to_jsonb(OLD)-'available'-'edit_revision') THEN
    RAISE EXCEPTION 'published_revision_immutable';
  END IF;
  IF NEW.edit_revision<>OLD.edit_revision+1 THEN RAISE EXCEPTION 'commercial_revision_conflict'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bundle_revision_guard BEFORE UPDATE OR DELETE ON bundle_revisions FOR EACH ROW EXECUTE FUNCTION protect_commercial_revision('bundle_id');
CREATE TRIGGER plan_revision_guard BEFORE UPDATE OR DELETE ON plan_revisions FOR EACH ROW EXECUTE FUNCTION protect_commercial_revision('plan_id');
