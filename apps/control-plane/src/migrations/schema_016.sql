-- Replace the revision guard: a content change on a validated row can never stay validated
-- (forced back to draft, validated_digest cleared) and never be published in the same step.
CREATE OR REPLACE FUNCTION protect_commercial_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refs integer; content_changed boolean;
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
  IF OLD.status='validated' THEN
    content_changed := (to_jsonb(NEW)-'status'-'validated_digest'-'edit_revision'-'available'-'published_at')
      IS DISTINCT FROM (to_jsonb(OLD)-'status'-'validated_digest'-'edit_revision'-'available'-'published_at');
    IF content_changed THEN
      IF NEW.status='published' THEN RAISE EXCEPTION 'validated_content_changed'; END IF;
      NEW.status := 'draft'; NEW.validated_digest := NULL;
    END IF;
  END IF;
  IF NEW.edit_revision<>OLD.edit_revision+1 THEN RAISE EXCEPTION 'commercial_revision_conflict'; END IF;
  RETURN NEW;
END $$;
