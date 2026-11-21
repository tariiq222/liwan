-- Package-6 order/payment sandbox authority. Orders carry an immutable quote
-- snapshot and a client idempotency key; the sandbox payment provider is the
-- ONLY confirmation source. Payment attempts are counted per order and a
-- provider event is processed exactly once per event id. Provisioning is
-- triggered by a paid order exactly once; a paid order whose tenant is not
-- active reports paid_not_ready instead of pretending success.
CREATE TABLE shared_orders (
  id uuid PRIMARY KEY,
  control_tenant_id uuid NOT NULL REFERENCES tenants(id),
  idempotency_key text NOT NULL,
  quote jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','paid','cancelled','paid_not_ready','provisioned')),
  payment_attempts bigint NOT NULL DEFAULT 0 CHECK (payment_attempts >= 0),
  provision_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX shared_orders_idempotency ON shared_orders(idempotency_key);
CREATE FUNCTION shared_order_quote_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'orders are permanent'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.control_tenant_id IS DISTINCT FROM OLD.control_tenant_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.quote IS DISTINCT FROM OLD.quote
     OR NEW.payment_attempts < OLD.payment_attempts THEN
    RAISE EXCEPTION 'order identity, quote and attempt counts are immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_order_identity BEFORE UPDATE OR DELETE ON shared_orders
  FOR EACH ROW EXECUTE FUNCTION shared_order_quote_immutable();
CREATE TABLE shared_payment_events (
  event_id text NOT NULL,
  order_id uuid NOT NULL REFERENCES shared_orders(id),
  kind text NOT NULL CHECK (kind IN ('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled')),
  payload jsonb NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id)
);
