# Refund policy (launch)

Status: **operator-approved refunds for launch**. Owner decision 9 in section 2 of
[the self-service pricing and trial design](../superpowers/specs/2026-10-24-self-service-pricing-and-trial-design.md)
(2026-10-24): the refund policy is written text plus a documented manual procedure, with no field. Since
2026-11-13 the 14-day refund of a card payment is made by the system through the payment provider when the vendor
requests it (see "Refund of the first payment"); every other refund is still returned by the operator, who records
the reference. Recording the refund of a first payment changes the subscription.

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
- A payment made through the payment provider (a card) is refunded by the system: requesting the refund also queues one
  `reconcile.refund` outbox row for the exact invoice amount. The refund worker confirms the original payment, asks the
  provider only for what it has not returned yet (under an advisory lock per order, so a retry, a double click, two
  operators or a restart never refunds twice), and when the provider confirms it records the note as `refunded` with the
  provider's reference. The audit trail names the operator who requested it as the actor and `system` as the executor,
  and the same code that the manual form runs arms the free-base lock. While the system owns the refund, recording by
  hand is refused (`refund_in_progress`, 409) and the console does not offer it.
- If the provider cannot refund (an error retrying does not change, or the six attempts are used), the note stays
  `pending`, the vendor "today" list shows `refund_rejected` and the invoice page shows the reason. Only then the
  operator checks the provider's dashboard, returns the money another way if it was not returned, and records the
  reference (step 4 below). The provider's own `refunded` event for money already credited adds no second note and no
  second lock.
- A payment made by bank transfer has no provider payment to refund: the operator returns the money by transfer and
  records the reference on the note (step 4 below).
- Recording the refund (by the system or by hand) drops the subscription to the free base in the same transaction, because the owner gives no
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
3. Only for a bank transfer, or after the automatic provider refund failed with no money returned: return the amount (a
   bank transfer; for a failed automatic refund, first check the provider's dashboard that it was not already returned).
   A card refund the console requested needs no step 3 or 4. Two states of an automatic refund close the form on
   purpose, because the customer's money may already be back: "refunded, recording" (the provider returned the money;
   only the record is retried until it succeeds) and "provider has not confirmed" (a refund call was made and its
   outcome is not verified; the worker keeps reading the provider and records it when the money shows as returned).
   The worker never hands such a row to the operator and never calls the provider a second time for the same money.
4. On the same invoice page choose "Record refund" on the pending credit note and enter the refund reference and a
   reason. The console offers this only when the server allows it (`manual_record_allowed`). This needs `vendor.billing.manage` (roles `owner` and `finance`) and a fresh step-up.
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
