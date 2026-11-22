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
- A payment the provider refunds (`payment.intervention`): any provider refund of a paid invoice, whether the order was
  already fulfilled or it is a trial checkout refunded before delivery (which also returns the subscription to the running
  trial), makes the invoice `credit_pending` with a pending credit note, reason "Payment refunded by the provider —
  manual review". The money has already left, so the operator reviews the entitlement and records the provider's refund
  reference on the note.
  The note carries the part the provider refunded, not the whole invoice: each further partial refund adds a note for
  its own part, a replay adds nothing, and the notes never add up to more than the attempt paid. Every non-void credit note of the invoice counts toward what is already credited, the vendor-requested one included (only a duplicate-charge note is other money): a refund the operator already recorded is not credited a second time when the provider's event arrives, and asking for a refund after the event attached to the existing pending note instead of opening a second one. A row that cannot
  become a note (a missing attempt, a refund above the payment, another currency) is closed as `failed` with its
  reason and a `payment.refund_rejected` audit event, and it shows in the vendor "today" list (billing access) as `refund_rejected` when it came from a provider refund event (the money has left) and as `refund_not_sent` when it is a failed worker refund (no refund was ever asked of the provider), until the invoice's credit covers it, by the same definition the worker uses (any non-void credit note, any origin, duplicate-charge notes excluded): a vendor-recorded refund clears it, voiding that note shows it again, and a later processed refund event for the attempt clears it too. A row with no attempt has no invoice to be covered on and stays; there is no operator action that dismisses it. It never blocks the other rows.
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
  `pending`, the vendor "today" list shows `refund_not_sent` and the invoice page shows the reason. Only then the
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

## An automatic refund that cannot finish

Owner decision 2026-11-22. A `reconcile.refund` row whose `provider_refund` mark is `attempted` (a refund call was made and its
outcome is not verified) or `returned` (the provider returned the money and recording keeps failing) is never closed or handed to
the operator by the worker: the customer could be paid twice. It is retried with a backoff of at most 60 minutes, and the invoice
page shows the note as stuck, with the row's age, tries, next try, the provider payment id and, for a reference conflict, the note
that holds the payment id. Three console actions, each needing `vendor.billing.manage`, none of which refunds money (only the
refund worker does, under the same per-order advisory lock; a held lock is `refund_in_progress`, 409):

- **Check again now** (both states): reads the payment at the provider, shows its status, refunded amount and payment id. It
  makes the row due so the worker runs its next step only for a `returned` row or an `attempted` row whose mark is at least 60
  minutes old; a younger `attempted` row is only read, because the worker would repeat the refund call at once. Changes nothing
  else; needs no step-up and no reason.
- **Release the hold** (`attempted` only; fresh step-up and a reason of 3 to 1000 characters): acts only on a definitive provider
  answer. The read must succeed and match the paying attempt (payment id, amount, currency, merchant account, mode). A payment
  refunded in full is marked `returned` as the worker would mark it; a paid payment with no refunded figure loses the mark and the
  worker takes over by its guarded path (a refund, or the manual form by the existing rules). Everything else is refused with 409:
  a failed read or a mismatch (`provider_status_unverified`), a refunded status with no usable figure
  (`provider_refund_amount_unverified`), a partial figure (`provider_refund_partial`), a mark younger than 60 minutes
  (`refund_attempt_too_recent`, from `attempted_at`, or the row's creation for an older row; the refusal and the invoice view
  give the time from which a release is possible, `release_from`, and every repeated refund call by the worker moves it an hour on), no payment adapter
  (`provider_refund_unavailable`). There is no operator override.
- **Record the returned refund** (`returned` only; fresh step-up, a reason and a resolution): `record` runs the worker's own
  recording with the operator as actor, under the payment id, or `<payment id>#<first eight characters of the note id>` when
  another note holds it (the other note is untouched and named in the audit event); it settles the order, arms the free-base lock as
  usual and finishes the row. The form and this action share one rule, serialised per invoice: both are refused with `refund_over_credit` when the invoice's refunded credit plus this note would exceed
  what the paying attempt paid. `already_recorded` voids the stuck note and finishes the row, only when the note holding the payment
  id is on the same invoice, settled and covers this note (otherwise `refund_not_duplicate`).

Audit events: `payment.refund_rechecked`, `payment.refund_hold_released` (with the provider figures read),
`invoice.credit_refunded` (with `resolved_stuck` and the conflicting note id) and `payment.refund_duplicate_closed`.

The provider's one-refund-per-payment rule stops a second card refund; nothing stops a bank transfer made by hand. A payment on
a stuck refund is therefore refunded only through the provider, never by transfer, while the hold stands.

## Voiding an unpaid renewal invoice is not a refund

Owner decision 2026-11-22. An issued renewal invoice that nobody paid is **voided**, not credited: no money was
received, so no credit note is made and nothing is refunded. The invoice and its lines are kept with status `void`.
A **credit note** is for money that was received; a **void** is for an invoice that was never paid. The two never share an
invoice: the console offers the void only on an unpaid renewal invoice and the refund only on a paid one.

- The vendor opens the unpaid renewal invoice and chooses "Void the invoice", picks what happens to the subscription
  (`end` drops it to the free base now, `rebill` leaves the next renewal run to issue a new invoice for the same period)
  and writes a reason. It needs `vendor.billing.manage` and `vendor.subscriptions.manage` together and a fresh step-up.
- It is refused while money may exist: a live or succeeded payment attempt on the order (`payment_reconciliation_required`),
  a customer's bank-transfer claim (`transfer_claimed`: record the transfer first), a paid renewal still being applied, a
  free-base lock in flight, or a workspace being deleted. A paid invoice is refunded as above, never voided.
- The order is cancelled for automatic refund, so a payment that still reaches the provider afterwards is refunded by
  the system and a `payment_after_cancellation` credit note records it.
- Audit event `invoice.voided` records who, why, the outcome, and the subscription state before and after.

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
