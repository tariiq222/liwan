# Refund policy (launch)

Status: **operator-approved refunds for launch**. Owner decision 9 in section 2 of
[the self-service pricing and trial design](../superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md)
(2026-10-24): the refund policy is written text plus a documented manual procedure, with no field and no
automatic refund path in this phase. Money only moves when the operator refunds it; recording the refund of a
first payment does change the subscription (see "Refund of the first payment").

## What triggers a refund

- A paid order whose fulfillment ends as `failed` (a permanent error, or retries exhausted after about four hours).
  The control plane marks the invoice `credit_pending` and records one pending credit note
  (`invoice_adjustments`, `kind='credit_note'`, `status='pending'`) for the full invoice total.
- A payment that arrives after the order was cancelled (`reconcile.refund`): the same pending credit note, reason
  "payment after cancellation — manual review".
- A payment the provider refunds after the order was fulfilled (`payment.intervention`): the invoice becomes
  `credit_pending` with a pending credit note, reason "payment refunded after fulfillment — manual review". The money
  has already left, so the operator reviews the entitlement and records the provider's refund reference on the note.
  The note carries the part the provider refunded, not the whole invoice: each further partial refund adds a note for
  its own part, a replay adds nothing, and the notes never add up to more than the attempt paid. Every non-void credit note of the invoice counts toward what is already credited, the vendor-requested one included (only a duplicate-charge note is other money): a refund the operator already recorded is not credited a second time when the provider's event arrives, and asking for a refund after the event attached to the existing pending note instead of opening a second one. A row that cannot
  become a note (a missing attempt, a refund above the payment, another currency) is closed as `failed` with its
  reason and a `payment.refund_rejected` audit event, and it shows in the vendor "today" list as `refund_rejected` (billing access) until the invoice's credit covers it, by the same definition the worker uses (any non-void credit note, any origin, duplicate-charge notes excluded): a vendor-recorded refund clears it, voiding that note shows it again, and a later processed refund event for the attempt clears it too. A row with no attempt has no invoice to be covered on and stays; there is no operator action that dismisses it. It never blocks the other rows.
- `needs_intervention` orders get no credit note automatically; the operator decides after reading Odoo back.

## Refund of the first payment (14-day guarantee)

Owner decisions 2026-11-06 (the window) and 2026-11-13 (the drop to the free base). The tenant has no refund button:
the customer asks by message, and the vendor acts in the vendor console.

- Only the customer's first payment is refundable, and only through the end of the Riyadh day that is
  `refund_window_days` (default 14) after the day it was paid. A renewal or any later payment is not refundable.
- The vendor opens the paid invoice and chooses "Request refund". This creates one pending `vendor_refund` credit
  note for the whole invoice. The window and the first-payment rule are judged here, once. A paid order whose delivery
  has not ended is refused with `fulfillment_pending` (409) until it ends.
- The vendor refunds the money at the payment provider (or by bank transfer) and records the reference on the note
  (step 4 of the procedure below). Nothing moves money automatically.
- Recording the refund drops the subscription to the free base in the same transaction, because the owner gives no
  paid value without payment. This happens when the refunded `vendor_refund` and `provider_refund` notes cover the
  whole invoice, the invoice bought something other than an AI top-up or tax, its order was delivered, it is the
  customer's first payment and the subscription is past its trial (`active`, `past_due` or `suspended`). Unpaid
  renewal invoices of the paid configuration are voided, the lock order is queued, and a
  `subscription.refund_lock_armed` audit event is written. Items bought by a second, unrefunded payment are kept.
  The tenant gets an email once the lock applies. The confirmation in the console says the subscription will drop.
- While an earlier lock order is still being delivered, recording is refused with `lock_pending` (409); record it again
  once the delivery settles.
- A partial provider refund, a provider refund of a later payment, and the system notes (`fulfillment_failure`,
  `payment_after_cancellation`, `duplicate_payment`, `automatic_refund`) never drop the subscription. They stay with the
  manual review above.

## Procedure

1. Find the invoice in the vendor-admin invoice page: a pending credit note is shown on it.
2. Confirm the cause (runbook section 4.1) and that the customer was not provisioned.
3. Refund the amount through the payment provider's dashboard. Nothing is refunded automatically.
4. On the same invoice page choose "Record refund" on the pending credit note and enter the provider's refund
   reference and a reason. This needs `vendor.billing.manage` (roles `owner` and `finance`) and a fresh step-up.
   The note becomes `refunded` with the reference, the recording account and the time, and an
   `invoice.credit_refunded` audit event is written. The action moves no money. Repeating it with the same
   reference returns the recorded note; a different reference on a closed note is refused (`credit_note_not_pending`).
   The invoice stays `credit_pending` (issued invoices are immutable), so the **credit note's status is
   authoritative**: the invoice status alone does not say whether money is still owed. The console invoice filter
   `credit_pending` therefore also lists invoices whose credit notes are already `refunded`; open the invoice to see
   which notes are still pending. A reference can be recorded on one credit note only (`refund_reference_in_use`, 409).
5. A second successful charge on an order that is already paid (for example an expired link that was paid late)
   is never ignored: the attempt is marked `succeeded`, a `payment.duplicate_charge` audit event is written and a
   pending credit note for that attempt's amount is created (reason "duplicate payment — manual review"). Refund it
   through steps 3 and 4. When an attempt pays an order, its other open attempts are cancelled at the provider.

## Known gaps

- The retry budget is fixed in code (10 attempts, 1 to 60 minutes); it is not a customer setting.
