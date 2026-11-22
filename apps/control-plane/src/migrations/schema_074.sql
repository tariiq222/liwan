-- The time a subscription left service: the moment its state became suspended (non-payment or vendor) or cancelled (a
-- cancellation taking effect, a workspace deletion), kept while it stays out and cleared when it returns to service. Analytics
-- history needs it to tell when a departed subscription stopped billing. A row that left before this column existed has no
-- recorded time and stays unknown.
ALTER TABLE subscriptions ADD COLUMN left_service_at timestamptz;

-- One trigger on the state column, so no departure or return can be missed whichever code path changes the state.
-- A move between two departed states (suspended to cancelled) keeps the first time; an explicit value is kept while the state stays.
CREATE FUNCTION track_left_service() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state NOT IN ('suspended','cancelled') THEN
    NEW.left_service_at := NULL;
  ELSIF TG_OP='INSERT' THEN
    NEW.left_service_at := COALESCE(NEW.left_service_at,now());
  ELSIF OLD.state NOT IN ('suspended','cancelled') THEN
    NEW.left_service_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER a_track_left_service BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION track_left_service();

-- The time is derived from the state, which already demands a revision bump when it changes: it never demands one by itself.
CREATE OR REPLACE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision'-'tenant_status_pushed'-'tenant_suspension_reason_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'tenant_status_pending_since'-'left_service_at')
     IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'tenant_status_pushed'-'tenant_suspension_reason_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at'-'renewal_failure'-'renewal_failed_at'-'tenant_status_pending_since'-'left_service_at') THEN
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'subscription_revision_conflict'; END IF;
  ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'subscription_revision_conflict';
  END IF;
  RETURN NEW;
END $$;
