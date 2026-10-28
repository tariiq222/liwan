# webvue_payments

Shared service (rank 3) for online payments. The tenant is its own merchant: it opens its
own account with a gateway and connects it here; WebVue never receives, holds or pays out
tenant money. Feature `payments.enabled` (catalog tier `payments`).

This version connects a gateway. Payable orders, the payer page, webhooks and refunds follow
the local planning spec (`.scratch/payments/spec.md`).

## Routes

All behind `payments.enabled` and the sensitive capability `payments.providers.manage`
(granted to `system_admin`):

- `GET /api/v1/payments/providers` — the current company's gateways that WebVue offers.
- `PATCH /api/v1/payments/providers/<id>` — `{state?, credentials?}`. Credentials are
  write-only: the answer reports only whether each one is set.
- `POST /api/v1/payments/providers/<id>/sync` — checks the stored keys against the gateway
  through the stock sync action; `synced` or `partial`, or 422 `provider_rejected` without
  the gateway's text.

## Providers

`webvue.payments.provider.registry` lists the offered stock provider codes: credential
fields, fixed defaults (Paymob's account country is Saudi Arabia), webhook path and sync
action. A provider addon adds its own definition by inheriting it. Paymob is the first.

## Access

- The capability group gets read/write on `payment.provider` and joins the group of the one
  key field stock restricts to system administrators (`paymob_secret_key`), so keys are
  written without elevation.
- Switching a gateway's mode is the one documented elevation: stock `write` archives saved
  tokens and toggles payment methods and the payment post-processing cron, all system-only.
  The method checks the capability and the provider's company before it elevates.
- Every route answers the same 404 for another company's provider and for a provider WebVue
  does not offer.

## Known gap

The webhook URL shown to the tenant is built from `web.base.url`, which provisioning does not
set yet (spec prerequisite P2). Until it does, the URL may not be the tenant's public address.
