-- Operator-recorded refund of a pending credit note: the provider-side reference, who and when.
-- The reason lives in the audit event; nothing here moves money.
ALTER TABLE invoice_adjustments
  ADD COLUMN refund_reference text CHECK (refund_reference IS NULL OR length(refund_reference) BETWEEN 3 AND 200),
  ADD COLUMN refunded_by text,
  ADD COLUMN refunded_at timestamptz,
  ADD CONSTRAINT invoice_adjustments_refund_recorded CHECK (
    (status = 'refunded') = (refund_reference IS NOT NULL AND refunded_by IS NOT NULL AND refunded_at IS NOT NULL)
    AND (status = 'refunded' OR (refund_reference IS NULL AND refunded_by IS NULL AND refunded_at IS NULL)));
