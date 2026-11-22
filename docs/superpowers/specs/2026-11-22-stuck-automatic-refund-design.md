# Release a stuck automatic refund from the vendor console

> Design. Status: the owner approved building it and took the decisions of section 4 on 2026-11-22; not built.
> Paths are under `apps/control-plane/src/commercial/` unless noted. The study read code only; nothing was run.

## 1. What happens today

- **Worker.** `processRefundOutbox` runs each `reconcile.refund` row through `refundThroughProvider`
  (`settlements.ts`). Before the refund call the row is marked `provider_refund: 'attempted'`; after a verified read
  shows the whole payment returned it is marked `returned` with `provider_payment_id`. Each mark is its own
  committed write.
- **No hand-off.** A row with either mark is never closed or given to the operator (`handOffAutomaticRefund`): the
  customer could be paid twice. It is retried through `deferOutbox`, with a backoff capped at 60 minutes, for ever.
- **Manual form blocked.** While the row is pending, `systemRefunds` answers `pending`, `recordRefundIn` throws
  `refund_in_progress`, and the invoice view has `manual_record_allowed: false` (`invoices.ts`).
- **Signal.** Only the `refund_unrecorded` attention item, after 24 hours (`attention.ts`). The page shows
  `refunded_recording` or `provider_unverified` with the stored reason and offers no action.
- **Provider lookup exists.** `lookupAttempt`, `lookupPayment` and `readPayment` return the cumulative refunded
  amount (`payment-adapter.ts`). There is no refund object or refund id: the provider allows one refund per payment,
  so the only reference is the payment id.

What keeps a marked row stuck:

| State | Repeating cause |
| --- | --- |
| `returned` | The payment id is already the `refund_reference` of another note (unique index, `schema_029.sql`). The worker stores the raw database message, not `refund_reference_in_use`. Also `refund_requester_missing`, `refund_not_full`, `invoice_already_refunded`. |
| `returned` or `attempted` | A check before the provider fails every time: `refund_attempt_unavailable` (the order moved on), `refund_note_unavailable` (the vendor note was voided), `provider_refund_payment_mismatch`. |
| `attempted` | The read after a failed refund call failed, so the mark stayed; later reads fail or give no figure (`provider_refund_amount_unverified`). |

## 2. Behaviour

Three actions on a pending credit note of `apps/vendor-admin/app/pages/invoices/[id].vue`, shown only in the two
stuck states. The view gains `since`, `attempts`, `next_attempt_at`, `provider_payment_id` and, for a reference
conflict, the conflicting note (invoice number, amount, cause, status, who recorded it and when).

- **Check again now** (both states). Reads the payment at the provider and shows status, refunded amount and payment
  id. It makes the row due (`next_attempt_at = now()`), so the worker runs its own next step, only for a `returned`
  row (the worker then only records) or an `attempted` row whose mark is at least 60 minutes old. A younger
  `attempted` row is only read and shown: a worker run that finds less than the whole amount refunded calls the
  provider's refund again, so making it due would let every click repeat a call that may still land. It changes
  nothing else.
- **Release the hold** (`attempted` only). The server reads the provider and acts only on a definitive answer:
  - Refunded in full: the row is marked `returned`, as the worker would mark it.
  - Nothing refunded: the mark is removed and the row is made due. The existing rules then apply: the worker
    refunds through its guarded path, or hands the note to the manual form.
  - Anything else: refused (section 3). Without a definitive answer the hold is never released; the row waits and
    stays in the attention list.
- **Record the returned refund** (`returned` only), after the page shows the conflict. Two outcomes:
  - `record`: the worker's own recording, with the operator as actor. The reference is the payment id, or
    `<payment id>#<short note id>` when another note holds it. The row is completed.
  - `already_recorded`: the conflicting note is on the same invoice and already credits this money. The stuck note
    is voided and the row completed.

## 3. Safety rules

- Capability `vendor.billing.manage` for all three. Release and record also need a fresh step-up and a reason of 3
  to 1000 characters. Check needs neither.
- Audit events: `payment.refund_rechecked`; `payment.refund_hold_released` with the provider figures read;
  `invoice.credit_refunded` (existing) with `resolved_stuck` and the conflicting note id;
  `payment.refund_duplicate_closed`.
- Every action takes the worker's advisory lock (`commercial-refund:<order id>`), then locks the outbox row and
  re-reads it. A held lock answers `refund_in_progress` (409). A row no longer pending returns the current view.
- A definitive answer means: the read succeeded; payment id, amount, currency, merchant account and mode match the
  paying attempt (the worker's own checks); and the figure is the whole amount (refunded) or absent with status
  `succeeded` (not refunded).
- Release is refused with 409 for: a failed read or a mismatch (`provider_status_unverified`); status `refunded`
  with no figure; a partial figure (`provider_refund_partial`, the worker keeps asking for the rest); a mark
  younger than 60 minutes (`refund_attempt_too_recent`, a call may still land); no payment adapter
  (`provider_refund_unavailable`).
- `refund_attempt_too_recent` carries `detail.release_from`, the time from which a release is possible (the mark plus 60
  minutes), and the invoice view carries it as `release_from` for an `attempted` row; the console shows it next to the next
  try. The worker writes a new `attempted_at` each time it calls the provider's refund again, so the clock restarts then, and
  its backoff is capped at 60 minutes (`deferOutbox`): the next retry is due at the end of the call plus 60 minutes. The window
  in which a release is allowed is therefore from `release_from` to the worker's next try, as long as that call lasted. Neither
  the 60 minutes nor the backoff changes. A release that arrives while the worker retries cannot do harm: both take the
  advisory lock `commercial-refund:<order id>` with a try-lock and neither waits. If the worker holds it, the release is 409
  `refund_in_progress` and the worker's new mark restarts the clock. If the release holds it, the worker's run does nothing
  (the release made the row due, so its next run) and then meets the released row, which it handles by its guarded path: a
  mark `returned` is only recorded, a removed mark is read again at the provider before any refund call, and a stale payload it
  claimed before the release is read again at the provider too. Either order, a refund call is made only after a fresh read
  that shows the money not returned.
- The `refund_over_credit` rule lives in `recordRefundIn`, the one recording both the form and the stuck record go through. It
  runs under a transaction advisory lock `commercial-refund-credit:<invoice id>` taken right after the note's own row lock
  (and the form's `refund_in_progress` check) and before the subscription and invoice locks, so two recordings on one invoice
  queue up and the second reads what the first committed. Nothing else takes that lock while holding the subscription or the
  invoice (the documented order is subscription, then invoice), so it adds no wait edge among them. A cycle would need a path
  that holds the invoice and waits for a note row another recording holds while queued on the gate; a deadlock is then
  detected by PostgreSQL and one transaction fails without writing.
- Record is refused when: the row is not `returned`; the note is not a pending credit note of the paying attempt's
  invoice; refunded credit plus this note would exceed what the attempt paid (`refund_over_credit`); or
  `already_recorded` is chosen while the conflicting note is on another invoice or covers less than this note.
- Record does not need the provider: the `returned` mark is written only after a verified read.
- No action calls the provider's refund endpoint. Money leaves only through the worker.
- Residual risk: the provider's one-refund rule stops a second card refund. Nothing stops a bank transfer made by
  hand, so the release text tells the operator to refund only through the provider.

## 4. Decisions (owner, 2026-11-22)

| # | Question | Decision |
| --- | --- | --- |
| D1 | `attempted` and the provider gives no definitive answer | Never release. |
| D2 | The payment id is held by another note | The suffix reference; the other note is untouched and named in the audit event (recommended default, taken). |
| D3 | How "check again" runs | It makes the row due for the worker; one code path moves money (recommended default, taken). |
| D4 | Minimum age of the `attempted` mark before a release | 60 minutes, from a new `attempted_at` in the payload; older rows use the row's creation time (recommended default, taken). |

## 5. Out of scope

Refunding from the console, partial refunds, editing a recorded reference, a new note when the vendor note was
voided after the money returned (`refund_note_unavailable` stays in the attention list), bulk actions, changing the
24 hour attention threshold, bank-transfer refunds, any Odoo accounting entry.

## 6. Tasks (one commit each)

1. Worker: store `refund_reference_in_use` instead of the raw constraint message; write `attempted_at` with the
   mark. Tests: the stored reason; the timestamp; an unmarked row behaves as before.
2. View and contract: the new `automatic_refund` fields, the conflict block and the allowed actions. Tests: each
   state, a conflict on the same invoice and on another, no fields for a row that is not stuck.
3. `recheckAutomaticRefund` and `POST /invoice-adjustments/:id/automatic-refund/check`. Tests: the row is due, the
   payload is unchanged, the lock held, no adapter, 403 without the grant.
4. `releaseRefundHold` and its route. Tests: refunded in full; nothing refunded; every refusal of section 3; a
   released row is then handed off by the existing rules; the audit row; `step_up_required`.
5. `recordReturnedRefund` and its route, both outcomes. Tests: the suffix reference; the order settled and the
   free-base lock armed as in `recordRefundIn`; `refund_over_credit`; idempotent replay; `already_recorded` refused
   across invoices; the worker finds the row done.
6. Vendor console: the three actions, the conflict panel, Arabic and English texts, the BFF entries bound to POST
   (`apps/vendor-admin/server/utils/proxy.ts`). Tests: shown, hidden and refused states; one e2e scenario.
7. Docs: `docs/operations/saas-commercial-runbook.md` and `docs/finance/refund-policy.md`.
