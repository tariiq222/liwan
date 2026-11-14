-- A tenant is deleted only on its own customer's request. The request is a two-step fact (an emailed code, then the company name),
-- followed by a window (TENANT_DELETION_WINDOW_DAYS) in which it can be withdrawn; at the end of the window it is `due`. This table is the whole record:
-- who asked, confirmed or withdrew, from which address, and what happened to the paid renewal. Nothing here drops anything; a later
-- stage adds the states that carry the drop out by replacing tenant_deletion_requests_state_check.
CREATE TABLE tenant_deletion_requests (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  state text NOT NULL,
  requested_at timestamptz NOT NULL,
  requested_by text NOT NULL,
  requested_from text,
  -- The emailed code: only its keyed hash is kept, and only while the request waits for it.
  code_seq integer NOT NULL DEFAULT 1,
  code_hash bytea,
  code_expires_at timestamptz,
  code_attempts integer NOT NULL DEFAULT 0,
  confirmed_at timestamptz,
  confirmed_by text,
  confirmed_from text,
  due_at timestamptz,
  due_marked_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by text,
  withdrawn_actor text,
  withdrawn_from text,
  withdraw_reason text,
  -- What confirming did to the paid renewal: stopped at the period end, already stopped, or could not be stopped (the refusal says why).
  renewal_outcome text,
  renewal_refusal text,
  revision integer NOT NULL DEFAULT 1,
  CONSTRAINT tenant_deletion_requests_state_check CHECK (state IN ('requested','confirmed','withdrawn','due')),
  CONSTRAINT tenant_deletion_requests_code_check CHECK (code_attempts >= 0 AND (state = 'requested' OR (code_hash IS NULL AND code_expires_at IS NULL))
    AND (code_hash IS NULL) = (code_expires_at IS NULL)),
  CONSTRAINT tenant_deletion_requests_window_check CHECK (state NOT IN ('confirmed','due') OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND due_at IS NOT NULL)),
  CONSTRAINT tenant_deletion_requests_due_check CHECK ((state = 'due') = (due_marked_at IS NOT NULL)),
  CONSTRAINT tenant_deletion_requests_withdrawn_check CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL)
    AND (withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_actor IS NULL)
    AND (withdrawn_by IS NULL OR withdrawn_by IN ('customer','vendor'))),
  CONSTRAINT tenant_deletion_requests_renewal_check CHECK ((confirmed_at IS NULL) = (renewal_outcome IS NULL)
    AND (renewal_outcome IS NULL OR renewal_outcome IN ('cancelled','already_cancelled','not_cancellable'))
    AND (renewal_refusal IS NOT NULL) = (renewal_outcome IS NOT DISTINCT FROM 'not_cancellable'))
);
-- One open request per customer: asked, confirmed or due. A withdrawn one is history.
CREATE UNIQUE INDEX tenant_deletion_requests_open ON tenant_deletion_requests (customer_id) WHERE state IN ('requested','confirmed','due');
CREATE INDEX tenant_deletion_requests_due ON tenant_deletion_requests (due_at) WHERE state = 'confirmed';
