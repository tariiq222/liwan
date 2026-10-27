# Refund policy (launch)

Status: **operator-approved refunds for launch**. Owner decision 9 in section 2 of
[the self-service pricing and trial design](../superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md)
(2026-10-24): the refund policy is written text plus a documented manual procedure, with no field and no
automatic refund path in this phase.

## What triggers a refund

- A paid order whose fulfillment ends as `failed` (a permanent error, or retries exhausted after about four hours).
  The control plane marks the invoice `credit_pending` and records one pending credit note
  (`invoice_adjustments`, `kind='credit_note'`, `status='pending'`) for the full invoice total.
- A payment that arrives after the order was cancelled (`reconcile.refund`): the same pending credit note, reason
  "payment after cancellation — manual review".
- `needs_intervention` orders get no credit note automatically; the operator decides after reading Odoo back.

## Procedure

1. Find the invoice in the vendor-admin invoice page: a pending credit note is shown on it.
2. Confirm the cause (runbook section 4.1) and that the customer was not provisioned.
3. Refund the amount through the payment provider's dashboard. Nothing is refunded automatically.
4. On the same invoice page choose "Record refund" on the pending credit note and enter the provider's refund
   reference and a reason. This needs `vendor.billing.manage` (roles `owner` and `finance`) and a fresh step-up.
   The note becomes `refunded` with the reference, the recording account and the time, and an
   `invoice.credit_refunded` audit event is written. The action moves no money. Repeating it with the same
   reference returns the recorded note; a different reference on a closed note is refused (`credit_note_not_pending`).
   The invoice stays `credit_pending` (issued invoices are immutable): read the credit note's status, not the
   invoice's.

## Known gaps

- `payment.intervention` outbox rows are written but not consumed by any worker.
- The retry budget is fixed in code (10 attempts, 1 to 60 minutes); it is not a customer setting.
