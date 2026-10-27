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
4. Record the refund outside the system until the console action below exists.

## Known gaps

- No console action closes a pending credit note, so it stays `pending` after the money is returned.
- `payment.intervention` outbox rows are written but not consumed by any worker.
- The retry budget is fixed in code (10 attempts, 1 to 60 minutes); it is not a customer setting.
