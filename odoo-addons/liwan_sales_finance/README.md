# liwan_sales_finance

Bridge (rank 5, `auto_install` on `liwan_sales` and `liwan_finance`): a draft customer invoice, or a down payment, made from
a confirmed staff order, and the links between the order and its invoices. It defines no model (R3) and neither application
names the other. It extends the Sales hooks (`_liwan_staff_extras`, `_liwan_actions`, the settings parsers and wire extras),
one Finance hook (`account.move._liwan_detail_extras`) and calls stock's `sale.advance.payment.inv` and `sale.order`; it
copies none of their methods (R9).

## The route

`POST /api/v1/sales/orders/{id}/invoices` answers the staff order shape, whose `invoicing` lists the new invoice first. The
body is one of:

| Body | Makes |
| --- | --- |
| `{method: 'order'}` | An invoice of what is invoiceable, less the down payments already invoiced (stock's regular invoice with `deduct_down_payments`) |
| `{method: 'percent', percent}` | A down payment of 1 to 100 percent of the order total |
| `{method: 'amount', amount}` | A down payment of that total, taxes included, above zero |

The invoice is a draft customer invoice in finance (`account.move`, journal of the order's company, the order's currency,
customer and payment terms). The bridge never posts: finance staff post it under finance's own rules (period locks, ZATCA),
and a later regular invoice deducts the down payments, as stock does. An `Idempotency-Key` header repeats the first answer
instead of making a second invoice, as in finance. The creation is written in finance's audit trail (`invoice_created`).

## Who may do it

The route needs both applications in the plan (`sales.enabled` and `finance.enabled`, write) and, in the working company,
`sales.orders.confirm` (the right to take an order forward) and `finance.invoices.manage` (the right to draft a customer
invoice); no capability was invented. Neither capability alone suffices (403 `forbidden`), and an order the caller does not
read in Sales (another company or branch, or another salesperson's under `own` visibility) is 404.

Whose order they may invoice is a per-company policy, the setting `invoice_actor`:

- `owner` (the default): the order's salesperson or a holder of `sales.documents.assign`, the same actor rule Sales uses for
  confirm and cancel (`liwan.sales.visibility._liwan_acts_for`). Any other caller who reads the order gets 403 `forbidden`
  with `details.reason` `not_the_salesperson`, and `can_invoice` and `can_down_payment` are false for them.
- `any_biller`: any caller who reads the order and holds both capabilities, even if the order is a colleague's (an accountant
  who also sells invoices what the salesperson sold).

The policy is read on the server for the route and mirrored in `can_invoice` and `can_down_payment`.

## Refusals

| Case | Answer |
| --- | --- |
| Not readable by the caller | 404 `not_found` |
| An online order (not a staff document) | 403 `forbidden`, `details.reason` `online_order`: `liwan_payments` owns its invoicing, which stock does when it is paid (`sale.automatic_invoice`, on by default) |
| Not the caller's order while `invoice_actor` is `owner` | 403 `forbidden`, `details.reason` `not_the_salesperson` |
| Another request holds the order right now | 409 `conflict` (retry; see Concurrency) |
| Not confirmed (draft, sent, cancelled) | 422 `order_not_confirmed` |
| Nothing left to invoice (all invoiced or drafted, or the whole order refused by stock because nothing is due) | 422 `nothing_to_invoice` |
| A down payment while the setting refuses it | 422 `down_payment_refused` on `method` |
| `percent` outside 1 to 100, `amount` not above zero, a body with another key or a figure that does not suit its method | 422 `invalid` on the field |
| A down payment above what is left to invoice | 422 `invalid` on `percent` or `amount`, `details.max_amount` |
| The company has no sales journal (a branch has none of its own until one is made) | 422 `no_journal` on `journal_id` |
| Either application not included | 403 `feature_not_included` |

## Concurrency

The route locks the order row (`lock_for_update(allow_referencing=True)`, the same `NO KEY UPDATE` lock the payments bridge
takes: the invoice only adds lines that point at the row) right after the caller is allowed to act on it and reads the order
again before it counts anything. Two requests for one order therefore never both find room: the second finds the row held and
answers 409 `conflict` (the client may retry; with an `Idempotency-Key` a retry of the first request replays its answer), and
a later one finds the first invoice among the figures (422 `nothing_to_invoice`, or the down payment room that is left).
`tests/test_invoice_lock.py` pins that the lock is taken before the figures are read.

## What the order says

The staff order shape gains `invoicing`, `null` for a caller without `finance.invoices.read` in the order's company (and
while Finance is not included), so no number or amount leaves the server:

`{status, amount_invoiced, amount_credited, amount_drafted, amount_to_invoice, amount_paid, invoices, can_invoice, can_down_payment}`
in the order's currency.

- `invoices` (newest first): `{id, number, state, kind, payment_state, invoice_date, invoice_date_due, amount_total,
  amount_residual, currency}`; `number` is `null` until posted, `kind` is `invoice`, `down_payment` (every product line is
  one) or `credit_note` (found by the invoice it reverses).
- `amount_invoiced` and `amount_credited` count posted invoices and posted credit notes; `amount_drafted` counts draft
  invoices, which claim an amount until they are posted or cancelled (cancelling one gives it back); `amount_to_invoice` is
  the order total less both and never below zero while the order is confirmed. A credit note does not open it again, as in
  stock: finance drafts a new invoice if the credited work is billed again.
- `status`: `none` (not confirmed, a zero total, or nothing live to show), `to_invoice` (no live invoice yet), `partial`,
  `invoiced` (nothing left to invoice, even if every invoice is still a draft).
- `can_invoice` (the whole order) needs the rights above, a confirmed staff order and stock's own `invoice_status` to be
  `to invoice` (an undelivered good is not due under the delivery policy); `can_down_payment` needs an amount left and the
  setting.

The finance invoice detail gains `source_order: {id, number}`: the order the invoice (or the invoice a credit note reverses)
was made from, only for a caller who reads that order in Sales now (Sales is included, they hold `sales.read` in the
document's company and the visibility setting shows it to them); otherwise `null`.

## Payments and invoices

Money reaches an order through two doors and `amount_paid` counts one: what payments settled on the posted invoices, less
what posted credit notes gave back. The bridge reads only finance (no payments table, no `sudo()`), so it works without
`liwan_sales_payments` and cannot disagree with it.

- `sale.automatic_invoice` on (the LiwanOS default, set by `liwan_payments`): a gateway payment on a confirmed staff order
  makes and posts its invoice at once through stock (a down payment while the order is partly paid, a final invoice when it
  is paid in full), reconciled with the payment, so the order shows invoiced and paid together.
- Off: the transaction stays on the order and only the payment block of `liwan_sales_payments` shows it. When staff make the
  invoice here, stock links the transaction to it, and when finance posts the invoice stock reconciles them: `amount_paid`
  counts the money from that moment. Until then `amount_paid` is 0 and the money is the order's `payment.amount_received`.
- A payment registered in finance on a posted invoice counts at once; a partial one counts its part. A credit note posted
  against an unpaid invoice cancels it (paid stays 0); money paid before the credit note stays paid and the credit note is
  open for finance to give back.

## Cancelling an invoiced order

The Sales state table gets one rule (`sale.order._liwan_actions`): an order with a posted invoice cannot be cancelled
(403 `transition_forbidden`, and `actions.cancel` is false): finance credits the invoice first. An order with only draft
invoices is cancelled by someone who may cancel them (`finance.invoices.manage` while `finance.enabled` can be written), and
stock cancels its drafts with it; a caller without that right, or while Finance is kept for reading only, does not get the
action. Cancelling a draft invoice in finance gives its amount back to
`amount_to_invoice`. A duplicate of an invoiced order carries no down payment line.

## Down payment lines

Stock records a down payment on the order itself: a section line and a line with `is_downpayment`, quantity zero, in
`order_line`. They are invoicing bookkeeping, so Sales hides them in its owning place (`sale.order._liwan_lines()`): the
staff `lines`, the public quotation shape and the quotation PDF (`_get_order_lines_to_report`) never list them, the lines
write cannot name or remove them, and `amount_total` does not change because of a down payment (the line has quantity zero).
`tests/test_down_payment_lines.py` pins each of these, and that a reopened or duplicated order shows only what was sold (a
reopened order keeps stock's own line in the database, tied to its invoice, and Sales still hides it).

## Setting

Two fields added to `liwan.sales.settings` (tenant scope, `sales.settings.manage`, through `PATCH /api/v1/sales/settings`),
present in the settings only while the tenant has Finance; writing either without Finance is 403 `feature_not_included`:

| Setting | Values | Default | Effect |
| --- | --- | --- | --- |
| `invoice_down_payment` | `allow`, `refuse` | `allow` | Read each time an invoice is made. `refuse`: only `{method: 'order'}` is accepted (422 `down_payment_refused`), `can_down_payment` is false |
| `invoice_actor` | `owner`, `any_biller` | `owner` | Read each time an invoice is made, on the server and in `can_invoice` and `can_down_payment`. `owner`: the order's salesperson or a holder of `sales.documents.assign`; `any_biller`: any caller who reads the order and holds both capabilities (see Who may do it) |

## One `sudo()`

`liwan.sales.service._liwan_make_invoice` runs stock's wizard elevated with the order's company, as stock itself creates the
invoice with `sudo()` so that a salesperson need not hold billing rights: the preparation reads `project.project` (stock
`sale_project`, readable only by project groups) and a branch session cannot read the root company's taxes, so a down payment
computed there would carry none. It runs after every check, touches one order and its invoice, never posts, and the invoice
returns in the caller's environment (`tools/arch_documented_sudo.json`).

## Stock entry points

`sale.advance.payment.inv` (`_create_invoices`, `_check_amount_is_positive`, `advance_payment_method`, `amount`,
`fixed_amount`, `deduct_down_payments`, `consolidated_billing`, `sale_order_ids`), `sale.order` (`_create_invoices`,
`_prepare_invoice`, `_get_invoiceable_lines`, `invoice_ids`, `invoice_status`), `sale.order.line._prepare_invoice_line` and
`account.move.line.is_downpayment` are pinned by `tests/test_stock_entry_points.py`, so a stock rename fails there.
`_prepare_invoice` is extended (a public hook) to give the invoice its company's own sales journal.

## Both modes

Every route and field works in `saas` and `non_saas`. With either application off, the other shows nothing of the bridge: no
`invoicing` while Finance is off, no route and no setting.

## Tests

`python3 -B tools/odoo_test.py --addons liwan_sales_finance,liwan_sales,liwan_finance --no-dependents`, and the bridge job
`deploy/ci/odoo-bridge.sh liwan_sales_finance`.
