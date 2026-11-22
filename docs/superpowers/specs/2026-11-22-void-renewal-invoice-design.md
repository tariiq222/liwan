# Void an unpaid renewal invoice from the vendor console

> Design for plan task T44 of [the audit fixes plan](../plans/2026-11-21-vendor-console-audit-fixes.md). Status:
> the owner took the decisions of section 5 on 2026-11-22; not built. Paths are under
> `apps/control-plane/src/commercial/` unless noted. The study read code only; nothing was run.

## 1. What happens today

- **Issue.** On the renewal date `generateRenewals` creates a `renewals` row, a quote pinned to the applied snapshot,
  an order (`kind='renewal'`, `awaiting_payment`) and an `issued` invoice (`renewals.ts`, `invoices.ts`). The due
  date is 7 days by default, 0 after a free-base lock.
- **Collection.** Saved-card charges run only while the invoice is `issued`, the order is not cancelled and the
  renewal is `invoiced`, `charging` or `past_due` (`saved-card-charges.ts`).
- **Dunning.** Past `due_at` the subscription becomes `past_due` with an `overdue` notice; after the plan's
  `grace_days`, and if `auto_suspend`, it becomes `suspended` (`renewals.ts`). A non-payment suspension leaves the
  workspace read-only (`suspension.ts`).
- **Period.** `renewal_at` moves only on fulfilment after payment. Until then the unpaid renewal holds the period:
  the unique index ignores only `superseded` rows (`migrations/schema_045.sql`).

Existing exits and their limits:

| Exit | Limit |
| --- | --- |
| Cancel renewal | Refused once `past_due` or `suspended` (`cancellation-rules.ts`). Before that, the lock voids the invoice at period end. |
| Order cancel | Refuses every renewal order (`orders.ts`). |
| Bank transfer | Pays the invoice; the amount must equal the total. |
| Free base | Automatic only (refund of the first payment, cancellation, unpaid first invoice after a trial). |
| Resume | Lifts the suspension with a fresh grace period; the debt stays. |

## 2. When a manual void is needed

1. A customer already `past_due` or `suspended` who will not pay and wants to stop. Today it stays suspended with an
   open invoice and no route to the free base. This is the main case.
2. An invoice that should not have been issued, or that must be issued again after the terms were corrected.
3. Uncollectable invoices that inflate the outstanding total.

## 3. Behaviour

One action, "Void invoice", on an `issued` invoice of `kind='renewal'`. In one transaction, locking the subscription,
then the order, then the invoice (the order `free-base-lock.ts` uses):

- **Invoice:** `issued` to `void`. No credit note: no money was received. The row and its lines are kept.
- **Order:** `cancelled=true, automatic_refund=true`, so a late capture is refunded automatically.
- **Renewal:** `superseded`, which frees the period.
- **Dunning and card:** both stop without new code; they select only `issued` invoices of orders that are not
  cancelled. `grace_ends_at` is cleared. A subscription in `past_due`, or suspended for non-payment, returns to
  `active` when no other overdue invoice remains. A vendor suspension (`manual_suspension`) is not lifted.
- **Subscription,** chosen by the operator in the form:
  - `end`: record a vendor cancellation and arm the free-base lock for this period start, as `armCancellationLock`
    does. The workspace drops to the free base. The existing cancellation notice is sent.
  - `rebill`: nothing more. The next renewal run issues a new invoice for the same period with a new due date; that
    invoice is the notice.

## 4. Safety rules

- Capabilities `vendor.billing.manage` AND `vendor.subscriptions.manage`, both required (in the built-in roles only
  the owner holds both), with a fresh step-up.
- Reason of 3 to 1000 characters. Audit event `invoice.voided` with actor, reason, outcome, order id, renewal id and
  the previous subscription state.
- Idempotent: a second call on a `void` invoice returns the current view.
- Refused with 409: status not `issued` or kind not `renewal` (`invoice_not_voidable`); a payment attempt in
  `created`, `redirected`, `pending` or `unknown` (`payment_reconciliation_required`); a succeeded attempt on the
  order; a customer bank-transfer claim on the invoice (`transfer_claimed`: the vendor confirms or refuses the
  transfer first); a renewal paid and still being applied; a free-base lock in flight; a workspace being deleted
  (`tenant_retiring`).
- Partial payment does not exist in this model: an attempt always carries the full total.

## 5. Decisions (owner, 2026-11-22)

| # | Question | Decision |
| --- | --- | --- |
| D1 | The subscription after the void | The operator picks `end` or `rebill`. A free period (`waive`) is not built. |
| D2 | Who may void | Both `vendor.billing.manage` and `vendor.subscriptions.manage`. |
| D3 | Void or credit note | Void (recommended default, taken). |
| D4 | A claimed bank transfer | Refuse (recommended default, taken). |
| D5 | Customer notice | Existing notices only (recommended default, taken). |
| D6 | Where the action is | The invoice page only (recommended default, taken). |

## 6. Out of scope

Voiding initial or change invoices (order cancel does that), paid invoices (the refund flow), partial write-offs,
discounts, bulk void, undoing a void, an automatic write-off policy, the `waive` outcome, any Odoo accounting entry.

## 7. Tasks (one commit each)

1. Contract: request schema `{reason, outcome}`, error codes, `voidable` and `void_block` on the vendor invoice view.
2. `voidRenewalInvoice` with every refusal of section 4 and the `rebill` outcome. Tests: each refusal; invoice, order
   and renewal states; the subscription back to `active` from `past_due` and from a non-payment suspension; a manual
   suspension kept; idempotent replay; the audit row; the next `generateRenewals` issues a new invoice;
   `chargeSavedCards` and `applyDunning` skip the voided one; a late capture is refunded.
3. The `end` outcome: vendor cancellation plus the armed lock. Check first that the lock runner accepts a
   subscription that was suspended a moment before, and whether the lock cause `cancelled` is right or a new cause is
   needed. Tests: the lock row, the drop to the free base on the next lock run, the cancellation notice, no new renewal.
4. Route `POST /invoices/:id/void` with both capabilities and step-up. Tests: 403 without either grant,
   `step_up_required`, 404, 422 for a short reason.
5. Vendor console: the action on `apps/vendor-admin/app/pages/invoices/[id].vue` with reason, outcome choice and the
   block reason when refused; Arabic and English texts; the BFF entry bound to POST. Tests: shown, hidden and blocked
   states; one e2e scenario.
6. Docs: `docs/operations/saas-commercial-runbook.md` and `docs/finance/refund-policy.md` (void against credit note).
