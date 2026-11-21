-- B1/B2 commercial control plane: customers, terms, subscriptions, orders, invoices, payments, renewals, outbox.
-- Registered as migration 13 in db.ts.
CREATE TABLE customers (
  id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) > 0),
  tenant_id uuid UNIQUE REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION commercial_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '%_immutable', TG_TABLE_NAME; END $$;

CREATE TABLE customer_terms_revisions (
  id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id),
  payload jsonb NOT NULL, reason text NOT NULL CHECK(length(reason) >= 3),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_terms_customer_idx ON customer_terms_revisions(customer_id, created_at DESC);
CREATE TRIGGER customer_terms_guard BEFORE UPDATE OR DELETE ON customer_terms_revisions FOR EACH ROW EXECUTE FUNCTION commercial_immutable();

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY, customer_id uuid NOT NULL UNIQUE REFERENCES customers(id),
  tenant_id uuid REFERENCES tenants(id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','trialing','active','past_due','suspended','cancelled')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
  applied_revision_id uuid, target_revision_id uuid,
  renewal_at date, auto_renew_enabled boolean NOT NULL DEFAULT false,
  auto_renew_consent_at timestamptz, provider_token_ref text,
  trial_ends_at timestamptz, grace_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT auto_renew_enabled OR auto_renew_consent_at IS NOT NULL)
);

CREATE TABLE subscription_revisions (
  id uuid PRIMARY KEY, subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  revision integer NOT NULL CHECK(revision >= 1),
  snapshot jsonb NOT NULL, quote_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, revision)
);
CREATE TRIGGER subscription_revisions_guard BEFORE UPDATE OR DELETE ON subscription_revisions FOR EACH ROW EXECUTE FUNCTION commercial_immutable();
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_applied_fk FOREIGN KEY(applied_revision_id) REFERENCES subscription_revisions(id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT subscriptions_target_fk FOREIGN KEY(target_revision_id) REFERENCES subscription_revisions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION subscription_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id THEN RAISE EXCEPTION 'subscription_identity_immutable'; END IF;
  IF (to_jsonb(NEW)-'revision') IS DISTINCT FROM (to_jsonb(OLD)-'revision') THEN
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'subscription_revision_conflict'; END IF;
  ELSIF NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'subscription_revision_conflict';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subscription_revision_guard BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION subscription_revision_guard();

CREATE TABLE orders (
  id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  kind text NOT NULL CHECK(kind IN ('new','change','renewal','branch_add','branch_archive')),
  quote_id uuid NOT NULL UNIQUE,
  target_revision_id uuid NOT NULL REFERENCES subscription_revisions(id),
  expected_applied_revision_id uuid REFERENCES subscription_revisions(id),
  payment_state text NOT NULL CHECK(payment_state IN ('not_required','awaiting_payment','paid','failed','refund_pending','refunded')),
  fulfillment_state text NOT NULL CHECK(fulfillment_state IN ('not_started','queued','applying','applied','failed','needs_intervention')),
  cancelled boolean NOT NULL DEFAULT false,
  effective_at timestamptz, idempotency_key text NOT NULL, request_digest text NOT NULL,
  due_now_minor bigint NOT NULL CHECK(due_now_minor >= 0), currency text NOT NULL, exponent integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, idempotency_key)
);
CREATE INDEX orders_subscription_idx ON orders(subscription_id, created_at DESC);
CREATE FUNCTION order_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.payment_state='paid' AND NEW.payment_state IN ('awaiting_payment','failed') THEN RAISE EXCEPTION 'order_payment_regression'; END IF;
  IF NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id OR NEW.quote_id<>OLD.quote_id
    OR NEW.target_revision_id<>OLD.target_revision_id OR NEW.due_now_minor<>OLD.due_now_minor
    OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_digest<>OLD.request_digest THEN
    RAISE EXCEPTION 'order_identity_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_payment_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION order_payment_guard();

CREATE SEQUENCE invoice_number_seq;
CREATE TABLE invoices (
  id uuid PRIMARY KEY, number text UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  order_id uuid REFERENCES orders(id),
  kind text NOT NULL CHECK(kind IN ('initial','change','renewal','adjustment')),
  status text NOT NULL DEFAULT 'issued' CHECK(status IN ('draft','issued','paid','void','credit_pending')),
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), exponent integer NOT NULL,
  subtotal_minor bigint NOT NULL CHECK(subtotal_minor >= 0), tax_minor bigint NOT NULL CHECK(tax_minor >= 0),
  total_minor bigint NOT NULL CHECK(total_minor >= 0),
  period_start date NOT NULL, period_end date NOT NULL,
  issued_at timestamptz, due_at timestamptz, paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_customer_idx ON invoices(customer_id, created_at DESC);
CREATE INDEX invoices_order_idx ON invoices(order_id);
CREATE FUNCTION invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' THEN RAISE EXCEPTION 'invoice_immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' AND NEW.number IS NULL THEN
      NEW.number := 'NSQ-' || to_char(now() AT TIME ZONE 'Asia/Riyadh','YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0');
      NEW.issued_at := COALESCE(NEW.issued_at, now());
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='draft' THEN
    IF NEW.status<>'draft' AND NEW.number IS NULL THEN
      NEW.number := 'NSQ-' || to_char(now() AT TIME ZONE 'Asia/Riyadh','YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0');
      NEW.issued_at := COALESCE(NEW.issued_at, now());
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'paid_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'paid_at') THEN RAISE EXCEPTION 'invoice_immutable'; END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='issued' AND NEW.status IN ('paid','void','credit_pending')) OR (OLD.status='paid' AND NEW.status='credit_pending')
  ) THEN RAISE EXCEPTION 'invoice_transition_invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoice_guard();

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), position integer NOT NULL,
  key text NOT NULL, kind text NOT NULL, timing text NOT NULL CHECK(timing IN ('now','renewal')),
  description text NOT NULL, quantity integer NOT NULL CHECK(quantity >= 0),
  unit_minor bigint NOT NULL, amount_minor bigint NOT NULL, currency text NOT NULL, exponent integer NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, source_revision_id uuid NOT NULL, free_quantity integer,
  UNIQUE(invoice_id, position)
);
CREATE TRIGGER invoice_lines_guard BEFORE UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION commercial_immutable();

CREATE TABLE invoice_adjustments (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), customer_id uuid NOT NULL REFERENCES customers(id),
  kind text NOT NULL CHECK(kind IN ('credit_note','debit_note')), reason text NOT NULL CHECK(length(reason) >= 3),
  amount_minor bigint NOT NULL CHECK(amount_minor >= 0), currency text NOT NULL, exponent integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','refunded','void')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), invoice_id uuid NOT NULL REFERENCES invoices(id),
  provider text NOT NULL CHECK(provider IN ('moyasar','simulator')), mode text NOT NULL CHECK(mode IN ('test','live','simulator')),
  provider_ref text, merchant_ref text,
  amount_minor bigint NOT NULL CHECK(amount_minor > 0), currency text NOT NULL, exponent integer NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','redirected','pending','succeeded','failed','canceled','unknown')),
  redirect_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_attempts_one_live ON payment_attempts(order_id) WHERE status IN ('created','redirected','pending','unknown');
CREATE UNIQUE INDEX payment_attempts_provider_ref ON payment_attempts(provider, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE payment_events (
  id uuid PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('moyasar','simulator')),
  provider_event_id text NOT NULL, attempt_id uuid REFERENCES payment_attempts(id),
  status text NOT NULL CHECK(status IN ('pending','succeeded','failed','refunded','canceled')),
  amount_minor bigint NOT NULL CHECK(amount_minor >= 0), currency text NOT NULL, exponent integer NOT NULL DEFAULT 2,
  verified boolean NOT NULL, confirmed boolean NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('accepted','rejected')), reason text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE renewals (
  id uuid PRIMARY KEY, subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  period_start date NOT NULL, period_end date NOT NULL, kind text NOT NULL DEFAULT 'renewal',
  invoice_id uuid REFERENCES invoices(id), order_id uuid REFERENCES orders(id),
  status text NOT NULL DEFAULT 'invoiced' CHECK(status IN ('invoiced','charging','paid','past_due','suspended','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, period_start, kind)
);

CREATE TABLE commercial_outbox (
  id uuid PRIMARY KEY, kind text NOT NULL, aggregate_id text NOT NULL, dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  UNIQUE(kind, aggregate_id, dedupe_key)
);
