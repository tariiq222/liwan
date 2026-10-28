# webvue_payments

Shared service (rank 3) for online payments. The tenant is its own merchant: it opens its
own account with a gateway and connects it here; WebVue never receives, holds or pays out
tenant money. Feature `payments.enabled` (catalog tier `payments`).

This version connects a gateway. Payable orders, the payer page, webhooks and refunds come
in later steps; until the webhook step opens its path, WebVue shows no webhook URL.

## Routes

All behind `payments.enabled` and the sensitive capability `payments.providers.manage`
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
