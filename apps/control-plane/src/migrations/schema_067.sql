-- Review of the deletion runner.
-- `hold_notice_seq` numbers the final hold: it starts at 1 and rises each time the hold is extended or re-armed, and the due and last-call notices of
-- hold N carry N in their dedupe key, so a delivered notice is always the notice of the hold being served.
ALTER TABLE tenant_deletion_requests ADD COLUMN hold_notice_seq integer NOT NULL DEFAULT 1 CHECK (hold_notice_seq >= 1);
-- When the runner first saw the kill switch on (cleared when it sees it off). A hold that ended before this moment was not served by a runner that could act on it.
ALTER TABLE control_plane_state ADD COLUMN deletion_enabled_since timestamptz;

-- From `deleting` on, nothing may create an order, a payment attempt, a saved card or a top-up for the customer, and automatic renewal cannot be switched on.
-- The customer routes refuse first with `tenant_retiring`; these triggers close every other path (vendor routes, jobs, webhooks that create).
CREATE FUNCTION customer_retiring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_deletion_requests r WHERE r.customer_id = NEW.customer_id AND r.state IN ('deleting','deleted')) THEN
    RAISE EXCEPTION 'tenant_retiring' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_customer_retiring BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION customer_retiring_guard();
CREATE TRIGGER payment_methods_customer_retiring BEFORE INSERT ON payment_methods FOR EACH ROW EXECUTE FUNCTION customer_retiring_guard();
CREATE TRIGGER ai_topups_customer_retiring BEFORE INSERT ON ai_topups FOR EACH ROW EXECUTE FUNCTION customer_retiring_guard();
CREATE FUNCTION payment_attempt_retiring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o JOIN tenant_deletion_requests r ON r.customer_id = o.customer_id WHERE o.id = NEW.order_id AND r.state IN ('deleting','deleted')) THEN
    RAISE EXCEPTION 'tenant_retiring' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_attempts_customer_retiring BEFORE INSERT ON payment_attempts FOR EACH ROW EXECUTE FUNCTION payment_attempt_retiring_guard();
CREATE FUNCTION auto_renew_retiring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auto_renew_enabled AND NOT OLD.auto_renew_enabled AND EXISTS (SELECT 1 FROM tenant_deletion_requests r WHERE r.customer_id = NEW.customer_id AND r.state IN ('deleting','deleted')) THEN
    RAISE EXCEPTION 'tenant_retiring' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER subscriptions_auto_renew_retiring BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION auto_renew_retiring_guard();
