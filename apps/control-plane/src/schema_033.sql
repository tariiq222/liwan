-- A1: every row this file references and does not create itself is inserted here first, because migrate() only applies a
-- schema file once: a database that applied origin/main's schema_012 has no `none` policy row (it was added to
-- schema_012 in release 1), so the retro revision below would violate plan_revisions.policy_revision_id's foreign key
-- and the whole migration would roll back. Same values as schema_012, so a fresh database inserts nothing.
INSERT INTO pricing_policy_revisions(id,timezone,rounding,tax_kind,tax_rate_bps,currency,approval_note)
VALUES('6f1c3d8e-0000-4000-8000-000000000002','Asia/Riyadh','half_up_per_line','none',NULL,'SAR','owner decision 2026-11-06: Liwan is not VAT-registered')
ON CONFLICT (id) DO NOTHING;

-- Vendor-editable billing settings the code must not hardcode: one row, changed from the vendor console.
-- refund_window_days (W7): a full refund is allowed only within this many days of the customer's first payment and
-- only for that payment; renewals and later payments are never refundable. Release 1: 14 days (owner 2026-11-06).
-- onboarding_fee_minor (W6): the one-time assisted onboarding on a first invoice, 499 at release (owner 2026-11-06).
-- The bank account below is where a customer transfers; empty means bank transfer is not offered yet.
CREATE TABLE billing_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  refund_window_days integer NOT NULL CHECK (refund_window_days BETWEEN 0 AND 365),
  -- The optional one-time assisted onboarding (a month with a staff member) on a first invoice; 0 offers none.
  onboarding_fee_minor bigint NOT NULL DEFAULT 0 CHECK (onboarding_fee_minor >= 0),
  onboarding_currency text NOT NULL DEFAULT 'SAR' CHECK (onboarding_currency ~ '^[A-Z]{3}$'),
  onboarding_exponent integer NOT NULL DEFAULT 2 CHECK (onboarding_exponent BETWEEN 0 AND 4),
  bank_account_name text NOT NULL DEFAULT '',
  bank_account_number text NOT NULL DEFAULT '',
  bank_iban text NOT NULL DEFAULT '',
  bank_instructions_ar text NOT NULL DEFAULT '',
  bank_instructions_en text NOT NULL DEFAULT '',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(bank_iban) = 0 OR bank_iban ~ '^SA[0-9]{22}$')
);
INSERT INTO billing_settings(singleton, refund_window_days, onboarding_fee_minor, updated_by) VALUES (true, 14, 49900, 'schema_033');

-- Bank transfer is a payment provider: the vendor records the transfer as received and the order is paid through the
-- same path a Moyasar success uses. The provider constrains itself; no adapter calls out for it.
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_provider_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_provider_check
  CHECK (provider IN ('moyasar','simulator','bank_transfer'));

-- A recorded transfer: the operator's reference is unique per provider (the reference index above covers it), and the
-- value date is the day the money reached the account, which may precede the day the vendor recorded it.
ALTER TABLE payment_attempts ADD COLUMN value_date date;

-- A11 (owner decision 2026-11-07): extra storage is bought in steps. Above `included_storage_mb` a customer adds
-- storage 10 GiB at a time until the extra reaches `storage_step_threshold_mb`, then 100 GiB at a time. All three are
-- vendor-editable values on the plan, seeded here; the validation reads them and never hardcodes a step.
ALTER TABLE plan_revisions
  ADD COLUMN storage_step_mb integer NOT NULL DEFAULT 10240 CHECK (storage_step_mb > 0),
  ADD COLUMN storage_step_threshold_mb integer NOT NULL DEFAULT 102400 CHECK (storage_step_threshold_mb > 0),
  ADD COLUMN storage_large_step_mb integer NOT NULL DEFAULT 102400 CHECK (storage_large_step_mb > 0),
  -- A6: the same rule the zod schema and planIssues enforce (contracts: storageStepsAligned). The two divisibility
  -- clauses are what make every advertised size buyable: the small-step range must end exactly on the threshold, and
  -- the threshold itself must be a whole number of large steps or the engine offers it and then refuses it.
  ADD CONSTRAINT plan_storage_steps_aligned CHECK (
    storage_large_step_mb >= storage_step_mb
    AND storage_step_threshold_mb >= storage_step_mb
    AND storage_step_threshold_mb % storage_step_mb = 0
    AND storage_step_threshold_mb % storage_large_step_mb = 0);
-- The seeded LiwanOS plan takes the defaults above; nothing else is rewritten.

-- A5: who a credit note came from. `vendor` is a refund the vendor records because the customer asked for it, and only
-- those carry the first-payment/window rule; `system` notes (duplicate charge, payment after cancellation, fulfilment
-- failure) keep the plain path. An explicit column, never inferred from the free-text created_by.
ALTER TABLE invoice_adjustments ADD COLUMN origin text NOT NULL DEFAULT 'vendor' CHECK (origin IN ('vendor','system'));
-- A customer-requested refund is the whole invoice, once: a second vendor refund of the same invoice is refused.
-- A system note is keyed by its own charge (a duplicate payment, a payment after cancellation), so each of those may be
-- refunded once without blocking another: scoping the rule to the vendor origin is what keeps a second duplicate from
-- stranding money. A total unique index would refuse it as invoice_already_refunded.
CREATE UNIQUE INDEX invoice_adjustments_one_refund ON invoice_adjustments(invoice_id) WHERE status = 'refunded' AND origin = 'vendor';

-- A5: the immutable moment a payment succeeded, written once. `updated_at` cannot carry it: reconciliation and sibling
-- cancellation touch it, which would slide the refund window and could change which payment was the customer's first.
ALTER TABLE payment_attempts ADD COLUMN succeeded_at timestamptz;
UPDATE payment_attempts SET succeeded_at = updated_at WHERE status = 'succeeded' AND succeeded_at IS NULL;
CREATE INDEX payment_attempts_succeeded_at ON payment_attempts(order_id, succeeded_at) WHERE succeeded_at IS NOT NULL;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_value_date_only_transfer
  CHECK (value_date IS NULL OR provider = 'bank_transfer');

-- The seed edits in schema_012.sql and schema_025.sql only reach a database that has not applied them yet: migrate()
-- records a version and never re-reads an applied file. A development database migrated before release 1 therefore
-- still prices the plan at 299, includes 5 GiB, may carry a stale ai.setup.monthly and is pinned to the 15% policy.
--
-- A published revision is immutable (protect_commercial_revision refuses anything but availability), so the correction
-- is a NEW published revision that supersedes the old one — the same way the vendor console would make it — rather
-- than an edit in place. On a database seeded after release 1 the newest revision already matches, and nothing is
-- written: the WHERE clause below is false.
-- Not ON COMMIT DROP: migrate() runs this file in one transaction, and the statements below read these tables
-- after the point where an ON COMMIT DROP table would already be gone.
CREATE TEMP TABLE liwan_release1_retro AS
  SELECT p.* FROM plan_revisions p
  WHERE p.plan_id = '00000000-0000-4000-8000-0000000000b1' AND p.status = 'published' AND p.available
    AND (p.policy_revision_id <> '6f1c3d8e-0000-4000-8000-000000000002' OR p.included_storage_mb <> 20480
         OR p.prices::text LIKE '%29900%' OR p.platform_limits ? 'ai.setup.monthly' OR p.platform_limits = '{}'::jsonb)
  ORDER BY p.version DESC LIMIT 1;

-- The new ids are fixed before the insert, so the reference rows below can name the revision they belong to.
CREATE TEMP TABLE liwan_release1_retro_map AS
  SELECT r.id AS old_id, gen_random_uuid() AS new_id FROM liwan_release1_retro r;

UPDATE plan_revisions SET available = false, edit_revision = edit_revision + 1
WHERE id IN (SELECT old_id FROM liwan_release1_retro_map);

INSERT INTO plan_revisions(
  id, plan_id, version, name, audience, audience_customer_id, status, available, term_months, currency,
  prices, platform_limits, included_bundle_revision_ids, optional_bundle_revision_ids,
  included_extra_branches, extra_branch_prices, extra_branches_limit,
  included_users, included_storage_mb, storage_step_mb, storage_step_threshold_mb, storage_large_step_mb,
  user_prices, storage_prices, policy_revision_id, trial_days, grace_days, auto_suspend, auto_renew_allowed,
  content_digest, validated_digest, published_at)
SELECT m.new_id, r.plan_id,
       (SELECT max(x.version) FROM plan_revisions x WHERE x.plan_id = r.plan_id) + 1, r.name, r.audience, r.audience_customer_id,
       'published', true, r.term_months, r.currency,
       '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":0}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":0}}]'::jsonb,
       (r.platform_limits - 'ai.setup.monthly') || '{"ai.messages.monthly":500,"ai.tokens.monthly":2500000,"ai.assist.monthly":100,"ai.tool_calls.per_run":8,"ai.output_tokens.per_run":2000}'::jsonb,
       r.included_bundle_revision_ids, r.optional_bundle_revision_ids,
       GREATEST(r.included_extra_branches, 1),
       '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":5000}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":50000}}]'::jsonb,
       r.extra_branches_limit,
       r.included_users, 20480, 10240, 102400, 102400,
       '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":2900}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":29000}}]'::jsonb,
       '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":100}},{"cadence":{"unit":"year","count":1},"amount":{"currency":"SAR","exponent":2,"minor":1000}}]'::jsonb,
       -- A free plan carries no trial (it would only end past_due), so the superseding revision drops it.
       '6f1c3d8e-0000-4000-8000-000000000002', 0, r.grace_days, r.auto_suspend, r.auto_renew_allowed,
       encode(sha256(convert_to('liwan-release1-retro:'||r.id::text,'UTF8')),'hex'),
       encode(sha256(convert_to('liwan-release1-retro:'||r.id::text,'UTF8')),'hex'),
       now()
FROM liwan_release1_retro r JOIN liwan_release1_retro_map m ON m.old_id = r.id;

-- B: the superseding revision lists the same optional bundles, so it must carry the same reference rows. A reference is
-- what keeps a bundle undeletable while a plan sells it; a clone that lost them would let the console delete a bundle
-- the published plan still offers.
INSERT INTO revision_references(revision_id,revision_kind,referenced_by_kind,referenced_by_id)
SELECT (jsonb_array_elements_text(r.optional_bundle_revision_ids))::uuid, 'bundle', 'plan', m.new_id::text
FROM liwan_release1_retro r JOIN liwan_release1_retro_map m ON m.old_id = r.id
ON CONFLICT DO NOTHING;

UPDATE commercial_plans c SET next_version = GREATEST(c.next_version,
  (SELECT max(r.version)+1 FROM plan_revisions r WHERE r.plan_id = c.id))
WHERE c.id = '00000000-0000-4000-8000-0000000000b1';

DROP TABLE IF EXISTS liwan_release1_retro_map, liwan_release1_retro;
