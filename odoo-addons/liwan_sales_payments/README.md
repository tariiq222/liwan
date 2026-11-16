# liwan_sales_payments

Bridge (rank 5, `auto_install` on `liwan_sales` and the shared service `liwan_payments`): a staff quotation can ask to be
paid before it becomes an order, and the payment confirms it. It defines no model; it extends the Sales hooks and the stock
payment transaction, and reuses the pay page, the gateway, the transaction and the refund service of `liwan_payments`. One `sudo()`: the sum of the order's own transactions, whose stock field Sales staff cannot read (`tools/arch_documented_sudo.json`).

## The choice

The choice of one quotation lives in stock's own fields: `require_payment` and `prepayment_percent` (a fraction). Wire
value `payment_to_confirm`: `off` (`require_payment` false), `full` (a percentage of 100) or `percent`, with
`prepayment_percent` as a whole number from 1 to 100. A percentage of 100 reads back as `full`.

The tenant's default is two fields added to `liwan.sales.settings`: `payment_to_confirm` (`off` by default) and
`prepayment_percent` (50), tenant scope, changed by `sales.settings.manage` through `PATCH /api/v1/sales/settings` (the
Sales settings parser and wire hooks, see `liwan_sales`). A new quotation takes the default once, through the Sales create
path (a duplicate included); the value kept on each quotation is what counts after that, so a change of the default applies
to new quotations only. The staff choose it per quotation in the body of `POST /api/v1/sales/orders` and of `PATCH` on a
draft (`payment_to_confirm`, `prepayment_percent`; 422 `invalid` on `prepayment_percent` unless the mode is `percent`).

Every route and field of the bridge works in `saas` and `non_saas`. While the tenant cannot take payments
(`payments.enabled` not included, or the tenant read-only) the settings carry neither value, a quotation is created with
`require_payment` false whatever the default, a choice other than `off` is 403 `feature_not_included`, and the staff and
public shapes carry `payment: null`.

## What received means

A quotation asks to be paid only with `require_payment` and a required amount above zero (`_liwan_asks_payment`): a total
of zero, or a percentage that rounds to 0.00, asks for nothing everywhere (acceptance confirms per its snapshot, the customer
sees no payment, the staff shape reads `status` and `link` `none`).


One rule for the confirmation threshold, `held`, `amount_received`, `amount_due` and the customer's state: a staff quotation
received the sum of its own authorized and done payments, less their done refunds (`sale.order._liwan_received`). A
transaction shared with another order is not counted and stays stock's, which confirms no grouped payment either. What can
go back counts done payments only (`_liwan_net_received` of `liwan_payments`): an authorized payment is not captured yet and
is voided at the gateway, not refunded. Before it is confirmed a staff quotation keeps nothing, so everything done it
holds may go back (`amount_refundable`); a confirmed one keeps its total, as an online order does.

## Money due back

Any money a quotation holds once it is cancelled (declined included), expired or reopened to a draft is due back, whatever
its amount: `held` names the state, `amount_to_refund` equals `amount_refundable`, and each payment that arrives on such a
quotation gets one chatter note. Sending it again does not confirm it (see "Sending again").

## What each page says

- Staff `GET /api/v1/sales/orders/{id}`: `payment` = `{mode, percent, currency, amount_required, amount_received,
  amount_due, amount_to_refund, amount_refundable, can_refund, status, link, held, needs_attention, attention}`. `status` is the payer
  status or `cancelled`. `link` is `none` (nothing asked, paid, being paid or confirmed), `ready`, `no_gateway` (payable but
  no live gateway, the check the pay page makes), `awaiting_signature` or `unavailable`. `held` says why money that reached
  what the quotation asks did not confirm it: `expired`, `reopened`, `cancelled` (any amount held) or `awaiting_signature`.
  `attention` is `payment_not_recorded` (money received but not recorded for an hour), `payment_reversed` (confirmed, then a
  payment it counted was voided, so it holds less than it asked), `payment_awaits_confirmation` (sent again without an
  answer mode, it holds what it asks and waits for a staff confirm) or null; `needs_attention` is true exactly when it is set.
  `amount_to_refund` is what must go back (all the money of an expired, reopened or cancelled quotation that holds what it
  asks, or what a confirmed order received beyond its total); `amount_refundable` is the most one refund may record now;
  `can_refund` is true when the reader may change the quotation in Sales, holds `payments.refund` in its company, the
  tenant can take payments and something may go back. An order the staff confirmed without the payment shows `link`
  `none` and `amount_due` 0.
- Customer `GET /api/v1/public/sales/quotations/{id}`: `payment` = `{percent, amount, currency, pay_url, state}` or null
  (nothing asked, the tenant cannot take payments, or the staff confirmed the order without the payment). `state` is
  `payable`, `awaiting_signature`, `processing`, `paid` (confirmed with what it asks), `received` (what it asks arrived and
  the seller has not confirmed the order yet: a customer who paid never reads `unavailable`) or `unavailable`; `pay_url` is
  the pay page's path with the quotation's own access token (`/pay/order/<id>?access_token=...`) only while `payable`, which
  needs a live gateway.
- The pay routes of `liwan_payments` open a staff quotation only while its own customer page opens (sent, confirmed or
  cancelled, and not reopened since): a draft, a reopened quotation and an old token after a reopen get the same 404 as
  Sales. Confirmed and cancelled ones stay readable so the pay page can show that it is paid or no longer payable.
- The send e-mail adds the amount and, when nothing else is needed and a gateway is live, the pay link; a customer who must
  sign first is told to.

## Signature, acceptance and payment

A staff quotation is payable only while it is `sent` and, when the tenant asked for a signature (`accept_and_sign`), signed.
The check is on the server (`sale.order._liwan_pay_state`), so the pay routes answer 409 `not_payable` to a customer who has
not signed. A quotation that asks to be paid is confirmed by its payment and never by the acceptance alone, whatever the
`acceptance_confirms` setting and whether the tenant can take payments now (`_liwan_acceptance_confirms`): the acceptance is recorded, the order stays `sent`, and the
payment confirms it; a customer who paid first and signs later confirms it by signing. With `accept` the payment is the
acceptance and is recorded as one; with `none` the payment alone confirms. Staff holding `sales.orders.confirm` may still
confirm an unpaid quotation by hand.

## Confirmation by payment

`payment.transaction._check_amount_and_confirm_order` sends a staff quotation to `sale.order._liwan_confirm_by_payment`,
which locks the order row and reads it again, then confirms through `liwan.sales.service._liwan_move` in the order's
company (the path staff confirm uses) only from `sent`, not expired, signed when a signature is asked, with what the
quotation asks received. The customer then gets the Sales confirmation e-mail once
(`liwan.sales.document._liwan_queue_confirmation_mail`): the tenant's outbound sender, the quotation's own `/quote/<id>`
link and no Odoo portal link, built like the send e-mail. Without a sender the order is still confirmed and a chatter note
says no e-mail went. A repeated callback finds the order confirmed and sends nothing. A row another transaction holds
raises `LockError` on the payment callback (stock retries it) and answers 409 `conflict` on the customer's acceptance.
Every other order, online orders and transactions shared by several orders included, is stock's.

A payment for a quotation that cannot be confirmed now (expired, reopened to a draft, or cancelled) is never refused and
never confirms the order, as `liwan_payments` does for its own late payments: the transaction stays recorded on the order,
one chatter note per transaction says why, and the staff record shows `held` and `amount_to_refund`. The staff send the
quotation again (below) or give the money back.

## Sending again

A send never confirms by itself: confirming needs `sales.orders.confirm`, and the reopened quotation may carry new terms the
money was not paid against. The send clears the answer as Sales does; the money already received stays recorded and is never
taken as an acceptance, and the customer's page reads `received` (or `payable` for a difference). Then:

- `accept` or `accept_and_sign`: the customer's new acceptance, or signature, confirms it through the payment path, with one
  confirmation e-mail, since the amount is reached.
- `none`: nobody answers, so staff with `sales.orders.confirm` confirm it; until then the staff shape reads `attention`
  `payment_awaits_confirmation` (`needs_attention` true).
- A payment that arrives on the sent, unexpired quotation still confirms it, as any payment does.

A draft that holds money keeps its customer (422 `invalid` on `customer_id`: the money belongs to the payer). Its lines and
percentage stay editable: priced higher, it is payable again for the difference after the send; priced lower, the surplus is
due back once it is confirmed (`amount_to_refund`).

## Refunds

`POST /api/v1/sales/orders/{id}/refunds` with `{amount, reference}` (the gateway's refund reference, the body of the
payments refund route) records a refund the tenant already made in its gateway dashboard. It needs `sales.enabled` and
`payments.enabled` (write), `sales.read` and `payments.refund`; Sales decides who reaches the document (404 unreadable, 403
`forbidden` for another salesperson's quotation or an online order, whose refunds stay on the payments orders list) and the
payments service (`liwan.payments.service._liwan_record_refund`) checks the capability in the order's company and the amount
(422 `invalid` on `amount` beyond `amount_refundable`, 409 `conflict` while a payment is still being recorded or for an exact
replay). The answer is the staff order.

## Tests

`python3 -B tools/odoo_test.py --addons liwan_sales_payments,liwan_sales,liwan_payments --no-dependents`, and the bridge job
`deploy/ci/odoo-bridge.sh liwan_sales_payments`.
