# webvue_payments

Shared service (rank 3) for online payments. The tenant is its own merchant: it opens its
own account with a gateway and connects it here; WebVue never receives, holds or pays out
tenant money. Feature `payments.enabled` (catalog tier `payments`).

A customer pays a posted invoice or an online order on the public pay page (`/pay/<kind>/<id>`)
through the tenant's own live gateway; the gateway's webhook and return are relayed to the stock
provider controller. Refunds come in a later step.

## Online orders

An online order is a stock quotation that a selling application opens for its customer through
`webvue.payments.service` (no HTTP): `_webvue_new_order(company, partner, prepayment_percent)`,
`_webvue_add_line(order, product, quantity)`, `_webvue_orders_of(lines)`,
`_webvue_request_cancel(orders, requested_by_customer, service_start)`, `_webvue_summary(order)`,
`_webvue_payment_path(document)`, and the refund rules of a product it sells: `_webvue_refund_rules(product)`
and `_webvue_set_refund_rules(product, refund_policy, refund_amounts, refund_tiers)`. No method takes a price or an amount:
the product's price and the stock order computation decide them. The order asks to be paid online
(all of it, or a deposit), asks for no signature, and stock confirms it once paid (and invoices it
when the tenant keeps "invoice when paid" on). The application keeps a link to the order line it
added; this addon has no field pointing at any application.

An order still unpaid at its deadline (the company's unpaid-order expiry, 60 minutes by default) is
cancelled by a cron every five minutes through stock `_action_cancel`; an order with a payment on its
way, or a checkout opened in the last 15 minutes, waits for a later run. A payment that arrives after
cancellation is recorded and makes the refund due; it is never refused or refunded automatically.

Money is never left in limbo. A payment the gateway reported as pending or authorized holds its
order for a day; a received payment whose recording on the order keeps failing holds it while stock
retries (four days) and is shown as needing attention after an hour; after that the order is
released and the money is due back. No pay link is offered for an order that could not be invoiced
once paid (invoice when paid on, and no sales journal in the company).

## Refunds

What a cancelled order gives back follows the refund rules of its products (a company default, which a
product may override): all of it (`full`, the default), a percent by how long before the service the
customer cancels (`notice`, at most five tiers per product), or nothing (`none`). The rules apply only
to a cancellation the customer asks for (`requested_by_customer`): what the merchant keeps is set once,
at cancellation, in `webvue_retained_amount`. A staff cancellation or an expiry gives everything back,
and money that arrives by mistake (a late or second payment) is always due back in full. The amount due
is the stored `webvue_refund_due_amount`.

Stock Paymob has no refund API, so the tenant refunds in its gateway dashboard and staff with
`payments.refund` record it with the gateway's reference: the whole amount due at once, or any part of
it where every product allows partial amounts (`refund_amounts`). The refund is a refund child of each
paid transaction it takes from; stock post-processing records the outbound payment and reconciles it
with the credit notes this addon builds for a cancelled order's posted invoices (a full reversal, or
proportional lines for a partial refund); what the merchant keeps stays invoiced. Stock posts the credit
notes during post-processing and, with invoice when paid on, emails them to the customer; under the Saudi
localization each carries the ZATCA reason "cancellation". A partial credit note that misses the amount by a
rounding cent says so in the order's chatter. Release gate: an accountant reviews partial credit notes before
the first release (spec 6.4).

## Install footprint

`sale` brings the stock modules that auto-install with it and the applications already present:
`sale_crm` (with `crm`), `sale_edi_ubl`, `sale_sms` and `spreadsheet_dashboard_sale`. They add
fields and backend views only; WebVue uses none of them. The bridge
`webvue_appointments_payments` installs itself when a database is created or when appointments or
payments is installed into one that has the other; on a database that already has both, install it
explicitly (`-i webvue_appointments_payments`).

## Routes

Settings, behind `payments.enabled` and `payments.settings.manage` (granted to `system_admin`):

- `GET /api/v1/payments/settings`, `PATCH /api/v1/payments/settings` — `{unpaid_order_expiry_minutes,
  invoice_when_paid, refund_policy, refund_amounts, revision}`. The expiry (5–1440 minutes) and the
  refund defaults (`full`/`none`, `due`/`any`) belong to the current company; invoice when paid is the one
  tenant-wide stock parameter `sale.automatic_invoice` (on by default). A stale revision answers 409 `conflict`.

Online orders of the current company, behind `payments.enabled`:

- `GET /api/v1/payments/orders` (`payments.orders.read`, granted to `system_admin`) — `{items, total}`,
  newest first; filters `refund_due` and `needs_attention` (`true`/`false`), `state` (`open`, `confirmed`,
  `cancelled`), `limit`, `offset`.
- `GET /api/v1/payments/orders/<id>` — the order with its lines, every payment and refund, and whether
  partial refunds are allowed. Another company's order and an order that is not online answer 404.
- `POST /api/v1/payments/orders/<id>/refunds` (`payments.refund`, granted to no built-in role) —
  `{amount, reference}`; 422 on `amount` beyond the rules, 409 `conflict` while another refund of the
  order is being recorded. The answer is the order.

Payer routes, under the public namespace (`auth='public'`, no session, the document's access token):

- `GET /api/v1/public/payments/invoices/<id>`, `GET /api/v1/public/payments/orders/<id>` — the document's
  merchant, number, amounts, status and payment options.
- `POST .../invoices/<id>/transactions`, `POST .../orders/<id>/transactions` — start a payment of what the
  document asks now; one open checkout per document (409 `payment_in_progress`).

Gateways, behind `payments.enabled` and the sensitive capability `payments.providers.manage`
(granted to `system_admin`):

- `GET /api/v1/payments/providers` — the current company's gateways that WebVue offers.
- `PATCH /api/v1/payments/providers/<id>` — `{state?, credentials?, account_country?}`.
  Credentials are write-only: the answer reports only whether each one is set. Whenever the
  gateway is on after the update, the gateway check below runs in the same request and a
  failure keeps nothing of the update.
- `POST /api/v1/payments/providers/<id>/sync` — the gateway check: the stock sync action
  validates the keys and **writes to the merchant's account** (Paymob names its integrations
  after the current mode, test or live), so it must run after every mode, key or country
  change. `synced`, or `methods_missing` when the account lacks a payment method the provider
  needs. Failures answer 422 `provider_sync_failed` without the gateway's text; a switched-off
  gateway answers 422 `provider_disabled`.

## Providers

`webvue.payments.provider.registry` lists the offered stock provider codes: credential
fields, the merchant account country (a tenant choice among the countries the gateway serves,
Saudi Arabia by default; it decides the gateway currency) and the sync action. A provider addon
adds its own definition by inheriting it. Paymob is the first.

## Access

- The capability group gets read/write on `payment.provider` and joins the group of the one
  key field stock restricts to system administrators (`paymob_secret_key`), so keys are
  written without elevation.
- Switching a gateway's mode is the one documented elevation: stock `write` archives saved
  tokens and toggles payment methods and the payment post-processing cron, all system-only.
  The method checks the capability and the provider's company before it elevates.
- Every route answers the same 404 for another company's provider and for a provider WebVue
  does not offer.

## Logs

Stock Paymob logs its token request and response through the payment logger. `const.py` adds
`api_key` and `token` to the stock list of masked keys, the same way stock Stripe adds its own.
WebVue's own warning on a failed check carries only the provider and the error class.
