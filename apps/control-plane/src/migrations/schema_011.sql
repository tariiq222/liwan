CREATE TABLE commercial_packages (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_version integer NOT NULL DEFAULT 2 CHECK(next_version > 1)
);
CREATE TABLE package_revisions (
  id uuid PRIMARY KEY,
  package_id uuid NOT NULL REFERENCES commercial_packages(id),
  version integer NOT NULL CHECK(version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  name text NOT NULL, description text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','published')),
  available boolean NOT NULL DEFAULT false,
  catalog_version text NOT NULL REFERENCES catalog_entries(version),
  catalog_tier text NOT NULL, source_sha256 text NOT NULL,
  limits jsonb NOT NULL, modules jsonb NOT NULL, features jsonb NOT NULL,
  content_digest text NOT NULL, validated_digest text,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  UNIQUE(package_id,version),
  CHECK(NOT available OR status='published'),
  CHECK((status='published') = (published_at IS NOT NULL)),
  CHECK(status='draft' OR (validated_digest IS NOT NULL AND validated_digest=content_digest))
);
ALTER TABLE tenants ADD COLUMN package_revision_id uuid REFERENCES package_revisions(id);
CREATE INDEX tenants_package_revision_idx ON tenants(package_revision_id);
CREATE FUNCTION protect_package_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' THEN RAISE EXCEPTION 'package_delete_forbidden'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.id<>OLD.id OR NEW.package_id<>OLD.package_id OR NEW.version<>OLD.version OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'package_identity_immutable';
  END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='validated') OR (OLD.status='validated' AND NEW.status IN ('draft','published'))) THEN
    RAISE EXCEPTION 'package_transition_invalid';
  END IF;
  IF OLD.status='published' AND (to_jsonb(NEW)-'available'-'revision') IS DISTINCT FROM (to_jsonb(OLD)-'available'-'revision') THEN
    RAISE EXCEPTION 'published_package_immutable';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'package_revision_conflict'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_revision_guard BEFORE UPDATE OR DELETE ON package_revisions FOR EACH ROW EXECUTE FUNCTION protect_package_revision();
CREATE FUNCTION protect_tenant_package() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE package_row package_revisions;
BEGIN
  IF TG_OP='UPDATE' AND OLD.package_revision_id IS NOT NULL AND
    (NEW.package_revision_id IS DISTINCT FROM OLD.package_revision_id OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version OR NEW.catalog_tier IS DISTINCT FROM OLD.catalog_tier) THEN
    RAISE EXCEPTION 'tenant_package_immutable';
  END IF;
  IF NEW.package_revision_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.package_revision_id IS DISTINCT FROM NEW.package_revision_id) THEN
    SELECT * INTO package_row FROM package_revisions WHERE id=NEW.package_revision_id FOR SHARE;
    IF package_row.status IS DISTINCT FROM 'published' OR NOT package_row.available OR package_row.catalog_version IS DISTINCT FROM NEW.catalog_version OR package_row.catalog_tier IS DISTINCT FROM NEW.catalog_tier THEN
      RAISE EXCEPTION 'package_unavailable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_package_guard BEFORE INSERT OR UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION protect_tenant_package();
