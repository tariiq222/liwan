-- The kind of a credit note is a typed fact, not a prefix of the free-text reason the operator also types into.
-- `cause` says why the note exists; `reason` stays the human explanation only. A vendor-origin note is always an
-- operator-requested refund, and a system note never is, so an operator's wording cannot change how a note is treated.
ALTER TABLE invoice_adjustments ADD COLUMN cause text;

UPDATE invoice_adjustments SET cause = 'vendor_refund' WHERE origin = 'vendor';
UPDATE invoice_adjustments SET cause = 'duplicate_payment' WHERE origin = 'system' AND reason LIKE 'duplicate payment — manual review%';
UPDATE invoice_adjustments SET cause = 'provider_refund' WHERE origin = 'system' AND reason LIKE 'payment refunded after fulfillment — manual review%';
UPDATE invoice_adjustments SET cause = 'payment_after_cancellation' WHERE origin = 'system' AND reason = 'payment after cancellation — manual review';
UPDATE invoice_adjustments SET cause = 'automatic_refund' WHERE origin = 'system' AND reason = 'Payment returned after an undelivered trial order';
-- Every other system note is a fulfilment-failure note: its reason is the failure code and its creator the caller's actor.
UPDATE invoice_adjustments SET cause = 'fulfillment_failure' WHERE origin = 'system' AND cause IS NULL;

ALTER TABLE invoice_adjustments
  ALTER COLUMN cause SET NOT NULL,
  ADD CONSTRAINT invoice_adjustments_cause CHECK (cause IN ('vendor_refund','duplicate_payment','provider_refund','payment_after_cancellation','automatic_refund','fulfillment_failure')),
  ADD CONSTRAINT invoice_adjustments_cause_origin CHECK ((origin = 'vendor') = (cause = 'vendor_refund'));
