# Payments (online payment by link)

Pages: `/settings/apps/payments` (staff), `/pay/[kind]/[id]`, `/pay/[kind]/[id]/status`,
`/pay/returned` (public, no account). Owner: `liwan_payments` (rank-3 shared service). The tenant is
its own merchant: it connects its own Paymob account and LiwanOS never holds tenant money. Staff routes
sit under `/api/v1/payments`; the payer and the gateway use the public namespace `/api/v1/public/payments`
(owner decision D3: `auth='public'`, no session, authorized by the invoice access token or the gateway
signature). The gateway calls `/payment/paymob/webhook` and returns the payer to `/payment/paymob/return`
on the tenant host; the Nuxt route `server/routes/payment/[code]/[kind].ts` relays them to the hooks route.
Personas and status values: [README](README.md).

Capability note: `payments.providers.manage` (sensitive) and `payments.links.manage` are held by the
built-in `system_admin` role only, so `it_admin` is the staff persona for gateway settings. Creating a
link also needs read access to the invoice, so it is run by a custom role holding `payments.links.manage`
with `finance.invoices.read`-level access, or by `it_admin` when the invoice is readable. The feature
switch is `payments.enabled`.

Token note: the Covers column names the hooks route for both methods; the Scenario column says which.
Quoted API errors are server messages and codes. The payer pages show their own Arabic text.

## Gateway settings page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-05 | Payments feature off | it_admin | The settings page entry is hidden; list answers 403 `feature_not_included` | `GET /api/v1/payments/providers` | planned | exclusive phase (feature off) |
| PAY-06 | Read-only or suspended tenant | it_admin | The list reads; every write (PATCH, sync) answers 403 `tenant_read_only` or `tenant_suspended` and the controls fail with an error | `PATCH /api/v1/payments/providers/<id>` | planned | exclusive phase (read-only/suspended tenant); `tools/e2e_tenant_state.py` |
| PAY-12 | Turn on test mode with all keys | it_admin | Mode switches at once, the gateway check runs in the same request, toast «تم تغيير وضع التشغيل», badge «تجريبي», methods list shows the synced methods | `PATCH /api/v1/payments/providers/<id>` | planned | needs a real Paymob sandbox account: a fake key fails the gateway check (see PAY-15); Needs a reachable Paymob sandbox or the mocked sync; record which |
| PAY-13 | Go live asks first | it_admin | Choosing «مباشر» shows the inline confirm «تفعيل الدفع المباشر؟»; cancel keeps the old mode; confirm switches to live and publishes the gateway | `PATCH /api/v1/payments/providers/<id>` | planned | inline confirm «تفعيل الدفع المباشر؟» shown and cancel keeps the mode (observed); confirming needs a real gateway; No dialog; inline confirm only |
| PAY-15 | Gateway refuses the keys | it_admin | 422 `provider_sync_failed` «the gateway could not confirm the account», UI text «تعذّر الاتصال بالبوابة أو رفضت المفاتيح…»; the gateway's own text is never shown or logged | `PATCH /api/v1/payments/providers/<id>` | fail | private security advisory GHSA-9xq5-v9r4-xfxc; UI shows «تعذّر الاتصال بالبوابة أو رفضت المفاتيح…», API 422 provider_sync_failed, but stock logs the gateway response body in the Odoo log; see findings4/payments.md; Typed keys stay in the inputs for another try |
| PAY-17 | Account lacks a payment method | it_admin | 422 `methods_missing` «the gateway account lacks a payment method this gateway needs»; UI «حسابك لدى البوابة لا يفعّل طريقة دفع…» | `PATCH /api/v1/payments/providers/<id>` | planned | needs a real Paymob sandbox account |
| PAY-18 | Change the account country | it_admin | The select offers the codes in `account_country_options` (Saudi Arabia first by default); choosing one saves and re-checks the gateway while on; an unlisted code answers 422 `invalid` «account_country must be one of …» | `PATCH /api/v1/payments/providers/<id>` | fail | #275; API rejects bad codes (422 «account_country must be one of AE, EG, OM, SA») and saving AE works, but no default and Saudi Arabia is last, not first; see findings4/payments.md |
| PAY-19 | Switch live back to test or off | it_admin | The state changes and the gateway is no longer offered to payers (see PAY-45); turning off skips the gateway check | `PATCH /api/v1/payments/providers/<id>` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: UI switch from live to متوقف answered 200 at once with no gateway call; live to test not run in UI; UI switch from live to متوقف answered 200 at once with no gateway call; live to test not run in UI |
| PAY-20 | Test connection button states | it_admin | Disabled with hint when keys are unsaved («احفظ المفاتيح أولًا…»), incomplete, or the gateway is off («شغّل الوضع التجريبي أو المباشر…»); with a live or test gateway it shows «الاتصال سليم» | `POST /api/v1/payments/providers/<id>/sync` | planned | observed: disabled with «احفظ المفاتيح أولًا…» when unsaved, hint «شغّل الوضع التجريبي أو المباشر…» when off; with fake keys the click answers 422 provider_sync_failed; the «الاتصال سليم» state needs a real gateway |
| PAY-21 | Sync API outcomes | api | 200 `{provider, status}` with `synced` or `methods_missing`; disabled gateway: 422 `provider_disabled` «switch the gateway to test or live first» field `state`; missing keys: 422 `provider_not_configured`; failure: 422 `provider_sync_failed` | `POST /api/v1/payments/providers/<id>/sync` | planned | observed 422 provider_disabled field state and 422 provider_sync_failed (fake keys, enabled); `synced`/`methods_missing` need a real gateway |
| PAY-22 | Another company's provider and unknown id | api | PATCH and sync answer 404 `not_found` «Record does not exist» for a provider of another company, a missing id, and a provider code LiwanOS does not offer; the two cases are indistinguishable | `PATCH /api/v1/payments/providers/<id>` `POST /api/v1/payments/providers/<id>/sync` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: branch admin PATCH and sync of the root provider and a missing id answer 404 not_found «Record does not exist»; unlisted code not tried; Use a branch admin against the root provider id; branch admin PATCH and sync of the root provider and a missing id answer 404 not_found «Record does not exist»; unlisted code not tried; Use a branch admin against the root provider id |
| PAY-24 | Mode change needs the capability inside the elevated write | api | The elevated state write re-checks capability and company; a PATCH in a company where the caller lacks the capability does not switch the mode | `PATCH /api/v1/payments/providers/<id>` | planned | not run; no path found to call the elevated write without the capability; `_liwan_payments_set_state` |
| PAY-25 | Gateway keys are not logged | api | After a sync with a failing gateway, the Odoo log has the provider and error class only, and no key, token or request text | `POST /api/v1/payments/providers/<id>/sync` | planned | Read the scratch Odoo log; `const.py` also masks `api_key` and `token` |

## Payment link

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-26 | Create a link for a posted customer invoice with a live gateway | it_admin | On the invoice page the «رابط الدفع» button copies the link and toasts «تم نسخ رابط الدفع»; API answers `{path}` like `/pay/invoice/<id>?access_token=…` | `POST /api/v1/payments/links` `cap payments.links.manage` | fail | #274; accountant+links role and finance-manager+links role get the path and the UI button copies the link with toast «تم نسخ رابط الدفع»; it_admin and a custom role with invoices.read get a raw Odoo 403; see findings4/payments.md; The button is on the finance invoice page |
| PAY-34 | Custom role with links but no invoice access | custom role (payments.links.manage) | An invoice the user cannot read answers 403 or 404, never a link; minting the token is a write on the invoice, check it does not fail with a raw error | `POST /api/v1/payments/links` | fail | #274; role with links.manage only answers 403 with the raw Odoo text about 'Journal Entry' (account.move) instead of a clean refusal; known #197; see findings4/payments.md; Doubt: `controllers/links.py:35` calls `_portal_ensure_token` unelevated; confirm the outcome for a reader without write on invoices |
| PAY-35 | Payments feature off or tenant read-only | it_admin | Button hidden; API answers 403 `feature_not_included` or `tenant_read_only` | `POST /api/v1/payments/links` | planned | exclusive phase (feature off or read-only tenant) |

## Public pay page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-43 | Expired link | visitor | The invalid-link page shows | `page /pay/[kind]/[id]` | decision | private security advisory GHSA-9xq5-v9r4-xfxc; The server has no token expiry; the text says «انتهت صلاحيته». Only a regenerated token invalidates a link. Owner decision needed |
| PAY-48 | Payments feature off | visitor | GET answers 403 `feature_not_included`; the page shows «تعذّر تحميل الفاتورة» with retry, not the invalid-link page | `GET /api/v1/public/payments/invoices/<id>` | planned | exclusive phase (feature off); Only 404 is treated as an invalid link |
| PAY-49 | Backend error | visitor | A 5xx shows «تعذّر تحميل الفاتورة» and the retry button reloads | `page /pay/[kind]/[id]` | planned | not run; the page loads server-side so a client-side 5xx could not be forced |
| PAY-50 | Start a payment | visitor | Clicking «ادفع الآن» answers `{redirect: {method, url, fields}}`; the button shows «جارٍ تحويلك…», a return cookie is written, and the browser goes to the https gateway page | `POST /api/v1/public/payments/invoices/<id>/transactions` | planned | needs a gateway that accepts the keys; the start fails with payment_unavailable (see PAY-56); The gateway page is the sandbox; stop at the redirect |
| PAY-51 | Amount and currency come from the invoice only | api | A body with `amount`, `currency_id`, `partner_id` or any extra field answers 422 `unknown_field` «field 'x' is not accepted»; the created transaction carries the invoice residual, its currency and its partner | `POST /api/v1/public/payments/invoices/<id>/transactions` | planned | unknown_field refusals observed (amount, currency_id, partner_id, foo); the created transaction values could not be checked because every start failed at the gateway; Check the transaction in Odoo |
| PAY-57 | Start with the feature off or the tenant read-only | api | 403 `feature_not_included` or `tenant_read_only`; the read of the invoice still works while retained reads are allowed | `POST /api/v1/public/payments/invoices/<id>/transactions` | planned | exclusive phase (feature off or read-only tenant) |
| PAY-58 | Back from the gateway restores a busy page | visitor | Browser back from the gateway re-enables the button and refreshes the invoice | `page /pay/[kind]/[id]` | planned | needs the real gateway page to go back from; `pageshow` handler |

## Gateway callbacks and return

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-63 | Amount or currency mismatch | gateway | A signed payload with another amount moves the transaction to error, not paid; a second identical bad notification also stays rejected | `POST /api/v1/public/payments/hooks/<id>/<id>` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: signed payload with another amount: transaction error «The amount from the payment data doesn't match…», invoice still payable; repeat also 200 with no change; currency mismatch not tested apart; `models/payment_transaction.py`; signed payload with another amount: transaction error «The amount from the payment data doesn't match…», invoice still payable; repeat also 200 with no change; currency mismatch not tested apart; `models/payment_transaction.py` |
| PAY-68 | Webhook while payments is switched off | gateway | The notification is still processed and the money recorded (no feature gate) | `POST /api/v1/public/payments/hooks/<id>/<id>` | planned | exclusive phase (payments feature off); Documented in `tools/route_gate_allowlist.json` |
| PAY-69 | Post-processing failure is retried | gateway | If confirming the payment fails, the notification stays recorded, the failure is logged and the cron retries it | `POST /api/v1/public/payments/hooks/<id>/<id>` | planned | locking the invoice made the callback wait 15 s and the relay answer 502; the transaction was processed after the unlock (finding); the cron retry was not exercised; Force a failure by locking the invoice |
| PAY-75 | Status page other states | visitor | `processing` shows «الدفع قيد التأكيد»; `not_payable` shows «لا يمكن دفع هذه الفاتورة الآن»; a bad link shows «رابط الدفع غير صالح»; a backend error shows retry | `page /pay/[kind]/[id]/status` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: processing, not payable and bad link states seen; backend error retry not run; processing, not payable and bad link states seen; backend error retry not run |

## Online order settings

Capability note: `payments.settings.manage` is held by the built-in `system_admin` role only (`it_admin`). The
expiry of an unpaid order is per company; «إصدار الفاتورة عند الدفع» (`invoice_when_paid`, stock
`sale.automatic_invoice`, on by default) is one value for the whole tenant and needs the capability in the
root company.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-86 | Settings with the feature off or read-only tenant | it_admin | GET and PATCH answer 403 `feature_not_included`; on a read-only tenant GET reads and PATCH answers 403 `tenant_read_only` | `GET /api/v1/payments/settings` `PATCH /api/v1/payments/settings` | planned | exclusive phase (feature off / read-only tenant) |

## Online orders: public pay page

Online orders are created by a selling application (today the paid booking types of Appointments, APT-91);
the payer opens `/pay/order/<id>?access_token=...` from the staff pay link.

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-87 | Payer pays an online order | visitor | The page shows «دفع الطلب», «رقم الطلب», the amount due, «آخر موعد للدفع» and the methods; starting answers `{redirect}`; after the signed webhook the order is confirmed, invoiced when «إصدار الفاتورة عند الدفع» is on, and the page shows «تم دفع هذا الطلب» | `page /pay/[kind]/[id]` `GET /api/v1/public/payments/orders/<id>` `POST /api/v1/public/payments/orders/<id>/transactions` `POST /api/v1/public/payments/hooks/<id>/<id>` | planned | needs a live gateway with test keys and a signed webhook; page shows «دفع الطلب» «رقم الطلب» amount and «آخر موعد للدفع» but «الدفع الإلكتروني غير متاح حاليًا لهذا الطلب» without a gateway; Live gateway with test keys; signed webhook as PAY-60 |
| PAY-89 | Deposit order | visitor | A deposit order shows `amount_due` as the deposit share and «إجمالي الطلب» with the total; once the deposit is paid the status is `paid` | `GET /api/v1/public/payments/orders/<id>` `page /pay/[kind]/[id]` | planned | deposit order shows amount_due 57.5 and «إجمالي الطلب» 230 (observed); the paid deposit status needs a live gateway; APT-86 type |
| PAY-92 | Order start refusals | api | An extra body key 422 `unknown_field`; missing or non-integer `provider_id`/`payment_method_id` 422 `invalid`; a pair not offered 422 `payment_unavailable`; a second start within 15 minutes 409 `payment_in_progress` | `POST /api/v1/public/payments/orders/<id>/transactions` | planned | unknown_field 422; missing or non-integer provider_id 422 invalid; unoffered pair 422 payment_unavailable (observed); payment_in_progress needs a started checkout; Same rules as invoices (PAY-51..PAY-55) |
| PAY-93 | Payment cannot be recorded | visitor | With invoicing on paid orders on and no sales journal, the order answers `status` not_payable and no pay link is issued | `GET /api/v1/public/payments/orders/<id>` | planned | a sales journal exists on this stack so the order is payable; the no-journal case cannot be built without changing Finance setup; Turn the switch off and the order becomes payable |
| PAY-95 | Expiry spares a payer on the gateway | visitor | The expiry cron leaves an order with a checkout opened less than 15 minutes ago, or a payment pending, and cancels it on a later run if still unpaid | `POST /api/v1/public/payments/orders/<id>/transactions` | planned | needs an opened checkout on a live gateway; `tools/e2e_cron.py` |
| PAY-97 | Order routes with the feature off | visitor | Read and start answer 403 `feature_not_included` | `GET /api/v1/public/payments/orders/<id>` `POST /api/v1/public/payments/orders/<id>/transactions` | planned | exclusive phase (feature off) |
