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
`_webvue_add_line(order, product, quantity)`, `_webvue_orders_of(lines)`, `_webvue_request_cancel(orders)`,
`_webvue_summary(order)` and `_webvue_payment_path(document)`. No method takes a price or an amount:
the product's price and the stock order computation decide them. The order asks to be paid online
(all of it, or a deposit), asks for no signature, and stock confirms it once paid (and invoices it
when the tenant keeps "invoice when paid" on). The application keeps a link to the order line it
added; this addon has no field pointing at any application.

An order still unpaid at its deadline (the company's unpaid-order expiry, 60 minutes by default) is
cancelled by a cron every five minutes through stock `_action_cancel`; an order with a payment on its
way, or a checkout opened in the last 15 minutes, waits for a later run. A payment that arrives after
cancellation is recorded and makes the refund due; it is never refused or refunded automatically.

## Routes

Settings, behind `payments.enabled` and `payments.settings.manage` (granted to `system_admin`):

- `GET /api/v1/payments/settings`, `PATCH /api/v1/payments/settings` — `{unpaid_order_expiry_minutes,
  invoice_when_paid, revision}`. The expiry (5–1440 minutes) belongs to the current company; invoice when
  paid is the one tenant-wide stock parameter `sale.automatic_invoice` (on by default). A stale revision
  answers 409 `conflict`.

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
