-- A declined card payment never ends an order: the attempt closes and the order stays payable (another card, a bank transfer). Only
-- cancellation and the order's own lifecycle end it, so the order has no `failed` payment state any more. An order a decline left
-- there goes back to awaiting payment, which is what every reader already treated it as, but only the latest order of its subscription:
-- an older declined order was superseded long ago (its customer moved on to another order), so it is cancelled with its unpaid invoice
-- voided and is never charged or dunned.
UPDATE invoices SET status='void' WHERE status='issued' AND order_id IN (
  SELECT o.id FROM orders o WHERE o.payment_state='failed'
    AND EXISTS (SELECT 1 FROM orders later WHERE later.subscription_id=o.subscription_id AND (later.created_at,later.id) > (o.created_at,o.id)));
UPDATE orders o SET cancelled=true WHERE o.payment_state='failed'
  AND EXISTS (SELECT 1 FROM orders later WHERE later.subscription_id=o.subscription_id AND (later.created_at,later.id) > (o.created_at,o.id));
UPDATE orders SET payment_state='awaiting_payment' WHERE payment_state='failed';
ALTER TABLE orders DROP CONSTRAINT orders_payment_state_check,
  ADD CONSTRAINT orders_payment_state_check CHECK (payment_state IN ('not_required','awaiting_payment','paid','refund_pending','refunded'));
CREATE OR REPLACE FUNCTION order_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.payment_state='paid' AND NEW.payment_state='awaiting_payment' THEN RAISE EXCEPTION 'order_payment_regression'; END IF;
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id OR NEW.quote_id<>OLD.quote_id
    OR NEW.target_revision_id<>OLD.target_revision_id OR NEW.due_now_minor<>OLD.due_now_minor
    OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_digest<>OLD.request_digest THEN
    RAISE EXCEPTION 'order_identity_immutable';
  END IF;
  RETURN NEW;
END $$;
