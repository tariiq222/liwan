-- A subscription whose invoice cannot be issued because its customer has no usable payment return origin.
-- Set by the trial-expiry and renewal runs, cleared once an order is generated; the vendor attention list reads it.
ALTER TABLE subscriptions ADD COLUMN billing_blocked_at timestamptz;

-- Like the Odoo push bookkeeping, the block marker is not a commercial change: it must not move the revision a quote was priced against.
CREATE OR REPLACE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at')
     IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'tenant_status_pushed'-'tenant_status_failures'-'tenant_status_next_at'-'billing_blocked_at') THEN
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'subscription_revision_conflict'; END IF;
  ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'subscription_revision_conflict';
  END IF;
  RETURN NEW;
END $$;
