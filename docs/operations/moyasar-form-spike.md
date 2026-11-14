# Moyasar sandbox spike: payment intents, saved cards, token charges and refunds

Date: 2026-11-13. Scope: a test-mode experiment against Moyasar's API. No product code was changed. This is evidence about the provider, not about the product: nothing here shows that LiwanOS accepts payments, and nothing was tried in live mode.

Method. About 260 HTTP calls against the documented API host with a test secret key and a test publishable key, using only the card numbers published in Moyasar's test-card documentation and the fake name "Test Customer". 63 test payments were created (direct, through intents and through tokens), plus 8 intents and 22 tokens (the rest came from `save_card`). All 22 tokens were deleted at the end. No webhook was registered and no account setting was touched. Keys appear nowhere in this document; token ids are shown as their first six characters. Where a result comes from the documentation only, it says so.

The 3-D Secure test flow turned out to be fully drivable over plain HTTP, so every 3DS outcome below was run, not guessed: the payment's `source.transaction_url` serves a device-info form, which posts to `/v1/card_auth/<id>/authenticate`, then an "ACS Emulator" page with a result selector (`AUTHENTICATED`, `UNAUTHENTICATED`, `CANCELLED_AUTHENTICATION`, `AUTHENTICATION_NOT_AVAILABLE`, `AUTHENTICATION_REJECTED`, `AUTHENTICATION_SERVER_ERROR`), then `acs_return`, which ends with a page that sets `window.location` to `<callback_url>?id=<payment id>&status=<paid|failed>&message=<text>`. A real bank challenge in a real browser was not exercised.

## Verdicts

| # | Question | Verdict | Evidence in brief |
|---|---|---|---|
| U1 | Intent fulfilled by the publishable key with `save_card` returns a saved card | Confirmed for the raw API. The exact request Moyasar.js makes in `use_payment_intent` mode could not be observed | `POST /v1/payment_intents/<id>/fulfill` with the publishable key, `client_secret` and `source{...,save_card:true}` returned 201, status `initiated`, `source.token` set. After the 3DS step the payment was `paid` and the token `active`. Only Moyasar.js 1.14.0 is downloadable from Moyasar's own CDN (it has no intent support); 2.x URLs return 403 there, and the docs strip the script tags. The docs say Moyasar.js 2.3.0 or later posts to the fulfill endpoint when `use_payment_intent: true` and `payment_intent: {id, client_secret}` are set |
| U2 | Client can set `given_id` and `metadata`; payment carries the intent's locked values; overrides are ignored; `client_secret` is re-readable | Confirmed, with a security consequence | Fulfil body carried `amount: 99999`, `currency: USD`, `description: HACKED`, `callback_url` of another host, plus `given_id` and `metadata`. The payment had amount 100, SAR, the intent's description and callback, `id == given_id`, and the client's `metadata` verbatim. No override was refused; they were ignored. The payment has no field that names the intent, and the intent has no field that names the payment. `GET /v1/payment_intents/<id>` with the secret key returns `client_secret` again, any time, in every status; the publishable key gets 403 |
| U3 | `source.token` readable after a paid `save_card` payment; token status over time; token object | Confirmed | Token id appears in `source.token` on the create response and on later fetches with the secret key (and also with the publishable key). Token status is `initiated` from creation until the 3DS step ends, then `active` after a `paid` payment, `inactive` after a failed 3DS or a decline. `GET /v1/tokens/<id>` fields: `id, status, brand, funding, country, month, year, name, last_four, metadata, message, verification_url, created_at, updated_at` |
| U4 | Server-side token charge without 3DS or CVC for Visa, Mastercard and mada | Confirmed | `source{type:token, token}` with the secret key: Visa, Mastercard and mada test cards all returned `paid` at once, no CVC, no 3DS. `callback_url` is not required for a token charge (paid without it). Forced 3DS: `source["3ds"]: true` returns `initiated` with `source.transaction_url`; after the challenge the payment is `paid`. Token states `initiated` and `inactive`, a deleted token, an unknown id and a malformed id all return 400 `invalid_request_error`, message "The token <id> is invalid." with no distinguishing code. A token created with `save_only: true` has status `save_only` (not in the docs' status list); charging it always returns `initiated` with a 3DS URL, and the token stays `save_only` after the payment is paid |
| U5 | Full and partial refunds, accumulation, over-refund, idempotency | Partly refuted: only one refund is accepted per payment | Full refund with no body works for token and intent payments. A partial refund (300 of 1000) returned 200 and the payment moved to status `refunded` with `refunded: 300`; every later refund on it (300 again, the remaining 100, 200 over the rest) failed with 400 `invalid_request` "Payment is already refunded." Same on intent and mada token payments. Refunds below 100 halalas are refused (`amount` must be at least 100). A full refund repeated returns 400 "Payment is already refunded." Void works on a paid payment within the window and a refund after it fails ("Only paid or captured payments can be refunded."). Void after a partial refund fails. Whether live accounts accept several partial refunds is unverified |
| U6 | Account accepts tokenization, token charges, payment intents | Confirmed | None of the calls returned a "not enabled" style error. Also accepted: `POST /v1/tokens` (default and `save_only`), card payments with `3ds: false` (MOTO, see risk below) |
| U7 | CSP origins and Moyasar.js version | Partly confirmed | See the CSP section. Current version could not be read from the docs (script tags stripped from every page); 1.14.0 downloaded, the docs name 2.3.0 as the intent minimum. SRI: no attribute visible in any doc source |
| U8 | `given_id` idempotency, 404 shape, abandoned payment | Confirmed | Same body with the same `given_id`: 201, same payment id and status, no second charge. Same `given_id` with another amount or another card: 400 `used_given_id`. A `given_id` already used by a failed payment cannot be reused with a good card (400 `used_given_id`). Non-UUID `given_id`: 400 `validation_error`. `GET /v1/payments/<unknown or malformed>`: 404 `record_not_found`, "The Payment record you were looking for was not found". An abandoned payment stays `initiated` with `transaction_url` until the 3DS session is used; it cannot be voided or refunded (400 "Only paid or authorized payments may be voided." / "Only paid or captured payments can be refunded."), and there is no cancel route (404). An abandoned payment turned to `failed` with message "3DS: The authentication session has expired." about 15 minutes after creation (created 18:57:52, seen failed at 19:12:53), which matches the documented 15-minute limit |
| U9 | Unfulfilled, cancelled, consumed, declined intents; expiry | Confirmed | Intent `expires_at` is created plus 60 minutes. Cancel returns 200, status `canceled`. Fulfil after cancel: 400 `intent_not_fulfillable` "...is canceled and cannot be fulfilled." Fulfil after fulfilled: 400 `intent_not_fulfillable`. Cancel twice or after fulfilment: 400 `intent_not_cancelable`. Wrong or missing `client_secret`: 400 `invalid_client_secret`, intent unchanged. Invalid card number or missing CVC: 400 `validation_error` with `errors{field: [...]}`, intent still `created`, retry possible. A declined card (payment `failed`) consumes the intent: status `fulfilled`, `fulfilled_at` set, a second fulfil fails |
| U10 | Webhook event names and verification event | Docs only | See the webhook section |

## Other findings that matter for the design

1. Intents do not stop the client from asking for no 3DS. A fulfil with `source["3ds"]: false` on a plain Visa test card returned `paid` immediately with no authentication. The test account accepts MOTO payments (`3ds: false`), so this is account configuration, not an intent feature. `save_card: true` combined with `3ds: false` is refused (400 "save_card options can't be used with MOTO transaction"). Whether a live account has MOTO off by default must be asked of Moyasar.
2. The client controls `metadata` and `given_id` in intent mode, so neither can identify the order. The server-locked fields that survive onto the payment are `description`, `callback_url`, `amount` and `currency`. A nonce placed in the intent `description` is the only trustworthy link from payment to attempt. The callback `?id=` query value is attacker-controlled; it only names a payment to fetch.
3. A payment created by a token charge has `source.token: null` and `ip: null`. The token id is not echoed, so the charge is tied to its token only through the `given_id` and `metadata` the server sent.
4. The publishable key can read any payment by id (including `source.token`, `metadata` and `ip`) and can charge a token. Treat token ids as secrets and never render a payment object from the publishable key.
5. A user-agent that Cloudflare dislikes is blocked: Python's default `urllib` agent got HTTP 403 with a Cloudflare 1010 body before any key check. A `curl` agent string passed. The product's Node `fetch` must be tried once against the sandbox.
6. No rate limiting was seen: 260 calls at roughly 0.4 s spacing, no 429, no `Retry-After` or rate-limit headers.

## Decline shapes (test mode)

All 17 documented decline cards were run with `3ds: false`. Each returned HTTP 201 with `status: failed`, `fee: 0`, and the reason only in `source.message` (upper-case text). `source.response_code`, `authorization_code`, `issuer_name`, `issuer_country` and the other issuer fields are absent from the sandbox payment object, although the create-payment documentation lists them for live use. Soft versus hard declines therefore cannot be told apart by code in the sandbox; only by message.

| Card family | `source.message` |
|---|---|
| unspecified | UNSPECIFIED FAILURE |
| insufficient | INSUFFICIENT FUNDS |
| lost card | DECLINED: LOST CARD |
| generic 05 | DECLINED |
| expired | DECLINED: EXPIRED CARD |
| limit | DECLINED: EXCEEDS WITHDRAWAL LIMIT |
| stolen | DECLINED: STOLEN CARD |

3DS-stage failures return `failed` with a `3DS:` message, and the saved token becomes `inactive`:

| Trigger | `source.message` |
|---|---|
| ACS result `UNAUTHENTICATED` or `CANCELLED_AUTHENTICATION` | 3DS: Card authentication declined. |
| ACS result `AUTHENTICATION_NOT_AVAILABLE` | 3DS: The authentication is unavailable, please try again later or contact issuer bank if problem persisted. |
| ACS result `AUTHENTICATION_REJECTED`, or card 4111115784228433 | 3DS: The authentication attempt was rejected by the issuer bank. |
| ACS result `AUTHENTICATION_SERVER_ERROR`, or card 4111113343111067 | 3DS: service error occurred. |
| card 4111116611600661 | 3DS: The card is not enrolled in 3DS service. (failed at once, no challenge) |
| card 4111118250252531 | 3DS: attempted but not available, please ensure that you have enabled Online Purchase from your bank portal. |

A decline that happens after a successful 3DS step (card 4123120001090000 with `save_card`) returns to the callback with `status=failed&message=INSUFFICIENT+FUNDS`, and the token is `inactive`.

## Paid payment object (fields relevant to verification)

Top level: `id, status, amount, amount_format, fee, fee_format, currency, refunded, refunded_at, refunded_format, captured, captured_at, captured_format, voided_at, description, invoice_id, ip, callback_url, created_at, updated_at, metadata, source, splits`. Status values seen: `initiated`, `paid`, `failed`, `refunded`, `voided`. `fee` is 118 on a 100-halala test payment (the sandbox fee is not proportional). `captured` stays 0 for a normal `paid` payment. `refunded` is the amount refunded; after a partial refund the status is `refunded` with `refunded < amount`, so status alone does not mean full. `metadata` is `null` when none was sent, and accepts non-string values (a number came back as a number).

`source` for a card: `type, company (visa|master|mada), name, number (masked, first six and last four with X between), gateway_id, reference_number, token, message, transaction_url`. `reference_number` is set on approved and declined sync payments, null while `initiated`. Callback query on return: `id`, `status`, `message`.

## Webhooks (docs only, not tested)

Event names from the "Available webhooks" page: `payment_paid`, `payment_failed`, `payment_voided`, `payment_authorized`, `payment_captured`, `payment_refunded`, `payment_abandoned`, `payment_verified`, `card_auth_authenticated`, `card_auth_failed` (the `card_auth_*` events are for selected merchants). The "Webhook reference" page spells the failure event `payment_faild` in its event table, and `payment_failed` elsewhere; the typo exists in the docs. A consumer should accept both spellings and confirm by fetching the payment. Payload: `id, type, created_at, secret_token, account_name, live, data`; `secret_token` is the consumer-chosen shared string, there is no signature. A `webhook_verification` event carries `data.webhook_id` and a six-digit `data.verification_code`, is sent once and not retried; the code expires after 30 minutes and locks after five wrong tries; until verified the webhook receives no events and missed events are not replayed. Delivery retries: five more attempts after the first (1, 10, 30 minutes, 1 hour, 2 hours), then the message is dropped; the endpoint must answer 2xx first.

## Content-Security-Policy

From the Moyasar.js 1.14.0 bundle and stylesheet (the only version downloadable from Moyasar's CDN) and from the 3DS pages:

| Directive | Needed |
|---|---|
| `script-src` | the host serving moyasar.js (the CDN host Moyasar documents; 1.14.0 came from `cdn.moyasar.com`); 2.x may be served from another host and this was not verified |
| `style-src` | the same CDN host for moyasar.css; the form also sets inline styles from script (`element.style`), which `style-src` governs only as `'unsafe-inline'` when set through attributes; direct CSSOM writes are not blocked |
| `connect-src` | `https://api.moyasar.com` (the only API host in the bundle; used for `POST /v1/payments`, and for the fulfil endpoint in 2.3+) |
| `img-src` | `data:` (card-brand logos are inlined as data URIs in the stylesheet) |
| `font-src` | none found |
| `frame-src` | none: 1.14.0 has no iframe; it navigates the whole window to `source.transaction_url` |
| `form-action` | not needed on the merchant page; the 3DS pages are on `https://api.moyasar.com` and the issuer's ACS, reached by top-level navigation |
| navigation | the payer leaves for `api.moyasar.com`, then the issuer, then returns to `callback_url` |

`unsafe-eval` is not needed: the single `new Function` in the bundle sits behind `globalThis` in a try block. Apple Pay code paths exist in the bundle but are inactive unless enabled. Subresource integrity: none of the docs sources shows an `integrity` attribute or a versioned-and-hashed URL; ask Moyasar for the hashes, or self-host the pinned file.

## Recommended binding for the first payment

Use a payment intent. The server creates the intent (`POST /v1/payment_intents`, secret key) with the exact amount, currency, a description that carries the attempt nonce, and the callback URL; the browser receives only the intent id and `client_secret` and fulfils it with the publishable key (`use_payment_intent: true` in Moyasar.js 2.3.0 or later, or a direct call). Reasons from the results:

- The plain form with `on_initiating` lets the page rewrite amount, description, callback and metadata before the request, and nothing ties the resulting payment to a server-side order. With an intent the amount, currency, description and callback are fixed server-side and a client override is ignored (U2), and a payer cannot create a payment that the server never authorized.
- An intent is single use and a decline consumes it (U9), so each retry needs a new intent; that gives a clean one-attempt-one-intent mapping.
- `save_card` is accepted on fulfil and yields a token the secret key can read (U1, U3).

Verification on the server must not trust anything the client sent. After the callback (or a webhook), fetch the payment by id with the secret key and require: `status == paid`, `amount` and `currency` equal to the attempt, `description` equal to the attempt nonce, `callback_url` equal to the locked URL, and `source.token` present when a card was to be saved with token status `active` (fetch the token). Do not use `metadata` or the callback `id` as identity (U2). Because the payment carries no intent id, the nonce in `description` is the link; the intent id is stored beside the attempt for cancel and for expiry.

Conditions on this recommendation: confirm with Moyasar that MOTO (`3ds: false`) is disabled on the live account, since an intent does not prevent it (finding 1); confirm that Moyasar.js 2.3.0 or later makes the fulfil request the way the raw call did; fall back to a direct fulfil call from the product's own form code if the library cannot be pinned or hashed.

## What remains unverified and should be asked of Moyasar

1. The exact request, headers and CSP origins of Moyasar.js 2.x in `use_payment_intent` mode, the current version, the URL and an integrity hash.
2. Whether the live account has MOTO (`3ds: false`) disabled, and whether an intent can forbid it.
3. Whether live accounts accept more than one refund per payment (the sandbox allows exactly one and moves the payment to `refunded` after a partial refund), and whether refunds below 1.00 SAR are possible.
4. Whether the `initiated` token of an expired abandoned payment also moves to `inactive` on its own (the payment did fail at about 15 minutes in the sandbox; the token check was not repeated after expiry), and whether `payment_abandoned` fires then.
5. Whether live payment objects expose `response_code` and issuer fields on declines (the sandbox does not), and the full list of messages that mean a hard decline.
6. Whether a CVC is required by some issuers on a token charge (docs: "some issuers require it"; the sandbox never did).
7. Whether a `payment_paid` webhook carries `source.token` for a `save_card` payment, and the real delivery behaviour (nothing was received: no webhook was registered).
8. Whether the Node `fetch` default user agent passes Cloudflare in front of the API.
9. A real 3DS challenge in a browser against an actual bank page, including the frictionless versus challenge split for mada.
10. Why a token created through `save_card` reaches `inactive` after a decline, and whether a new 3DS step can revive it (the sandbox shows no revive route).

## Implications for the adapter

All names are in `apps/control-plane/src/commercial/moyasar-adapter.ts` unless noted.

- `createAttempt`: today it posts an invoice and returns a redirect URL. For intents it must post `/payment_intents` and return the intent id and `client_secret`; `CreateAttemptResult` in `payment-adapter.ts` needs a client-secret field and no redirect URL. Put the attempt nonce in `description`; stop using `metadata.attempt_id` as the binding.
- `fromPayment` and `verifyEvent`: `attempt_id` is read from `metadata`, which the client controls in intent mode. Read the nonce from `description`. `provider_ref` falls back from `invoice_id` to the payment id; intent payments have no invoice, so the attempt must store the payment id from the first verified fetch.
- `lookupAttempt` and `lookupByAttemptId`: they read invoices. An intent gives no payment reference, so a lookup by attempt needs the payment id (from the callback `id` after a fetch-and-match on description) or a payment list filtered by description, which was not tested.
- `cancelAttempt`: replace `PUT /invoices/<id>/cancel` with `POST /payment_intents/<id>/cancel`; treat 400 `intent_not_cancelable` as "already consumed or cancelled".
- `refund`: the sandbox accepts one refund per payment, the minimum is 100 halalas, and a partial refund sets status `refunded` with `refunded < amount`. The result must carry the cumulative `refunded` figure and callers must not assume status `refunded` means a full refund. Map "Payment is already refunded." to a distinct code, since `settlements.ts` (`refundThroughProvider`) retries on a generic provider error.
- `chargeToken`: `callback_url` is optional for a token charge; send `3ds: false` explicitly is not needed (default behaviour was no 3DS for `active` tokens); a `save_only` token returns `initiated` with `transaction_url`, which the adapter currently maps to a pending event with no way to finish it. Use a fresh `given_id` for every retry: a failed payment burns its `given_id` (`used_given_id`). The payment does not echo the token, so the caller must keep the token-to-payment link itself.
- `getToken`: `active` is the only usable status; others seen are `initiated`, `inactive`, `save_only`. Deleted and unknown tokens return 404 on `GET /tokens/<id>` and 400 "The token ... is invalid." on a charge.
- `call`: it collapses every non-404 failure to `provider_error` plus the HTTP status and message. The Moyasar error `type` (`used_given_id`, `intent_not_fulfillable`, `intent_not_cancelable`, `invalid_client_secret`, `validation_error`, `invalid_request`) is available in the body and should become the error code so callers can tell a consumed intent from an outage.
- `WEBHOOK_STATUS`: add `payment_faild` next to `payment_failed`. `OBJECT_STATUS` has no `save_only`, and `refunded` needs the cumulative figure to separate partial from full.
- `payments.ts` `confirmEvent` and `lookupPayment`: the equality check on `provider_ref` assumes the invoice id for hosted payments; for intent payments it must compare payment id, amount, currency, description and callback URL as listed under the recommended binding.
- `renewals.ts` (token charge) and `settlements.ts` (`refundThroughProvider`): no change needed for the happy path; the retry rules above apply.

## Open for step 3

- A payment made directly with the publishable key (not through an intent) can carry any description, amount and callback. The description-based attempt identity (`payment-description.ts`) is therefore trustworthy only for a payment that came from a server-created intent. The form flow must bind a payment to its attempt by more than the description: the intent reference stored on the attempt (the intent id is not on the payment, so it is checked by reading the intent), the locked callback URL, amount and currency, and a first verified fetch of the payment with the secret key before anything is settled.
- A successful payment that did not go through 3-D Secure cannot be told apart from the payment object: the sandbox object has no field for it and a client can ask for `3ds: false` (the adapter's `authenticated` is always null). The provider-side switch that forbids such payments (open question 2 above) must be confirmed on the live account before go-live.

## Browser run of the form (2026-11-14)

Scope: a test-mode run of the installed `moyasar-payment-form` 2.3.0, mounted by a small local harness in headless Chromium (Playwright) with the options object that `moyasarFormConfig` in `apps/web/app/utils/cardPayment.ts` builds (the helper itself was bundled, not copied; only its `./subscription` import was stubbed), the Content-Security-Policy that `deploy/shared/securityHeaders.mjs` gives the pay path (imported, not copied), and a callback route shaped like ours (`/api/commercial/payment-callback?attempt=<uuid>&k=<secret>` on `127.0.0.1`). The harness created each intent the way `createIntent` does (amount 100, SAR, description `LiwanOS payment <attempt uuid>`, locked callback), fetched payments and intents with the secret key, and recorded requests as origin, path and body key names only. About 27 intents and 15 payment objects were created (11 completed through the form, 1 abandoned at the 3-D Secure step, 3 hand-made over HTTP), plus 1 saved card token, which was deleted. Only documented test cards, the name "Test Customer", no webhook, no account setting. Keys, card numbers and full ids appear nowhere here; ids are shown as six characters and an ellipsis. The provider accepted an `http://127.0.0.1` callback URL in test mode; HTTPS callbacks were not exercised.

### Verdicts

| # | Question | Verdict | Evidence |
|---|---|---|---|
| F1 | Form mounts in intent mode, no console error; network and CSP | Refuted as shipped, confirmed once fixed | With the options as built today the form does not mount. The package refuses a handler that is not an async function and prints "On failure must be a promise based callback"; the page shows "Form configuration issue!" and no inputs. With an `async` handler it mounts, no console error. Requests at mount: the page and its own script only, none to the provider. After submit the only provider API call is `POST /v1/payment_intents/<id>/fulfill` (plus the browser's own preflight for the custom header `X-Moyasar-Form-Version`). No CSP violation in any normal flow. The error reporter (`appsignal-endpoint.net/collect`) is not called in normal use; a forced render error (language `xx`, which our page cannot send) made the package call it, and the browser blocked it under `connect-src` (violation reported, nothing sent). A direct fetch from the page to that origin is blocked the same way. The package then shows "Something went wrong" (a render failure, not a consequence of the block). Messages about `cloudflareinsights` and `cdn-cgi/rum` come from the provider's own 3-D Secure pages and their own report-only policy, not from ours |
| F2 | Successful payment, request shape and return | Confirmed | Request body keys: `amount, currency, description, publishable_api_key, callback_url, client_secret, source{type,name,number,month,year,cvc}`. No `3ds`, `metadata` or `given_id` key; `save_card` only when the option is on. Answer: 201, payment `initiated` with `source.transaction_url` (the documented Visa test card). The browser then navigates the whole window: `.../v1/card_auth/<id>/prepare`, `authenticate`, `acs_emulator`, `set_auth_result`, `acs_return`, and returns to the intent's locked callback, never to the `callback_url` option. Return query names, in order: `attempt`, `k` (ours), then appended `id`, `status`, `message` (`paid`, `APPROVED`). The fetched payment's `callback_url` equals the intent's locked URL exactly, including `k`, in all 11 payments completed through the form. The documented frictionless Visa card skips the emulator (`prepare`, `acs_return`, return) and is paid |
| F3 | `save_card` and the token | Confirmed | `save_card: true`: the fetched paid payment has `source.token`, the token is `active` (brand visa, funding debit, last four, month and year present). Off: `source.token` is null. The token was deleted afterwards and is no longer readable |
| F4 | 3-D Secure challenge | Confirmed | Complete the emulator with `AUTHENTICATED`: payment `paid`, intent `fulfilled`. While the browser sits on the emulator page, the payment is `initiated` and the intent is already `fulfilled` (seen in the 4 challenges where the payment id was captured). `UNAUTHENTICATED`: the browser returns to the locked callback with `status=failed`, message "3DS: Card authentication declined."; payment `failed`, intent `fulfilled` |
| F5 | Declines | Confirmed, with one extra path | Insufficient-funds Visa: goes through the emulator, returns to the locked callback (with `k`), `status=failed`, message "INSUFFICIENT FUNDS". The 3-D Secure rejection Visa: no emulator page, returns to the locked callback (with `k`), message "3DS: The authentication attempt was rejected by the issuer bank.". The "not enrolled" Visa: the fulfil answer itself is `failed` ("3DS: The card is not enrolled in 3DS service."), no provider page, and the browser goes to the form's own `callback_url` option: query `attempt, id, status, message`, no `k`. The page shows no error in any of these because the window leaves. After every decline the intent is `fulfilled`, so a retry needs a new intent. The payment's stored `callback_url` is the locked one with `k` even when the browser returned through the option |
| F6 | Tampering | Confirmed; the 3DS exposure is real | Options `amount 99999`, `currency USD`, `description HACKED`, `callback_url` on another host: the payment is 100 SAR, carries the locked description and locked callback, and the browser returned to the locked callback. The button label is drawn from the `amount` option (not screenshotted), so a wrong option misleads the payer but not the charge. The form has no way to send `3ds`: the card `source` is built from fixed fields, and `on_initiating` may only change `callback_url, description, metadata, amount, splits, publishable_api_key, currency, save_card, use_payment_intent, payment_intent`. A hand-made fulfil with the publishable key, the `client_secret` and `source["3ds"]: false` returned 201 and `paid` at once, with no `transaction_url`, and the same call's tampered fields were ignored. The same call without the `3ds` key returns `initiated` with a challenge. So MOTO is enabled on this test account and an intent does not prevent it |
| F7 | Publishable key only | Confirmed, and it leaks `k` | `GET /v1/payments/<id>` with the publishable key: 200, full payment including `callback_url` with `attempt` and `k`, `metadata`, `ip` and `source.token` (when saved). The payment list: 403. `GET /v1/payment_intents/<id>` with the publishable key: 403 "User not authorized", no `client_secret`; the intent list route: 404. With the secret key the intent read returns `client_secret`. So the callback secret is readable by anyone who holds a payment id and the public key (which every pay page carries); the payer's own browser URL holds it too after the return |
| F8 | Brands, language, layout | Confirmed | mada, Visa and Mastercard documented test cards each reached `paid` (Mastercard with the English form). Arabic form: Arabic labels, placeholders, validation messages and button ("ادفع 1.00" with the riyal sign). In the `dir="ltr"` host inside an RTL page the card number, expiry and CVC stay left to right, labels and errors align right, and nothing overlaps at 560 px wide (narrower phones not tried). The 3-D Secure emulator page is English and left to right, on the provider's domain. Screenshots below |
| F9 | Dead intents | Confirmed | Cancelled intent: 400, `type: intent_not_fulfillable`, "This payment intent is canceled and cannot be fulfilled.". Already fulfilled intent: `intent_not_fulfillable`. Wrong `client_secret`: `invalid_client_secret`, intent unchanged (`created`). All three reach `on_failure` as `{type, message, errors: null}`, so the `DEAD_INTENT_FAILURES` check in `cardPayment.ts` matches. The package shows an Arabic line plus the English provider message in a red banner that disappears after about 3 seconds; the inputs stay usable. A real expiry (60 minutes) was not waited for |

Query names the provider appends on return: `id`, `status`, `message`, after whatever the callback URL already had. Paid returns `status=paid&message=APPROVED`.

Screenshots (scratch directory `/private/tmp/claude-501/-Users-tariq-code-liwan/bf5b2b5c-f62d-40ea-9a07-7a2e486abebe/scratchpad/moyasar-form-run/shots/`): `F2-visa-initial.png` (Arabic form), `F8-validation.png` (validation errors), `F2-visa-acs.png` (3-D Secure emulator), `F2-visa-final.png` (return page of the harness), `F8-mc-initial.png` and `F8-mc-final.png` (English), `F1-shipped-initial.png` (configuration error as shipped), `F9-cancelled-final.png` (dead intent banner), `F5-insufficient-final.png`, `F5-rejected3ds-final.png`.

### What contradicts the code

1. `apps/web/app/components/subscription/PaymentForm.vue` and `apps/web/app/utils/cardPayment.ts`: `on_failure` is passed as a plain arrow function. The package accepts only an async function, so the pay page shows "Form configuration issue!" and never offers a card field. Fix: build `on_failure` as `async failure => ctx.onFailure(failure)` in `moyasarFormConfig`, type it as returning a promise in `apps/web/app/types/moyasarPaymentForm.d.ts`, and add a unit test that checks the built handler's `constructor.name` is `AsyncFunction`. The same rule applies to any `on_initiating`, `on_completed` or `on_redirect` handler added later.
2. Nothing in the code assumes it, but the `k` secret travels in the browser URL on every return that goes through the locked callback and is readable with the public key (F7). `relayPaymentReturn` already never reads `k`, sends `no-referrer` and `no-store`; the edge and application access logs must not record the query string of `/api/commercial/payment-callback`. The attempt secret therefore proves "this payment was made through our intent" against outsiders who lack a payment id, not against someone who holds the id.
3. `form-payments.ts` (`callbackMatches`) assumes the payment's `callback_url` equals the intent's locked one. That held in every run, including returns that came through the form's own `callback_url` option (F5), so the comparison is sound, but the relay must keep working when the browser arrives without `k` (the immediate-decline path). It does today.
4. The spike's Callback line ("`id`, `status`, `message`") is right; the parameters come after `attempt` and `k`.
5. The 2.3.0 package is what the first spike asked about: it posts to `/v1/payment_intents/<id>/fulfill` in `use_payment_intent` mode as the raw call did (U1 condition met). The default Node `fetch` user agent passed the provider's edge with a 200 (open question 8 of the spike answered for the test API).

### Still needs the provider's answer

- Whether MOTO (`3ds: false`) is disabled on the live account, since the intent does not prevent it (F6 confirms the same on this test account).
- Whether a real HTTPS callback and a live-mode run behave as the localhost test did, and the error `type` for an intent that expired after 60 minutes (not waited for).
- Whether the live key hides the "Test mode active" line the form prints with a test key.
- A real bank challenge (the emulator is not a bank page), and the frictionless against challenge split for mada.
- The published pinned file and integrity hash of the package, if it is ever loaded from their CDN; our build bundles it.

## Provider facts applied in the code (2026-11-14)

What the documentation and the two test runs established is now used by the control plane and the pay page. Closed by these changes:

- Open question 5 above (live payments expose `response_code`): the adapter carries `source.response_code` of a failed payment, and `commercial/payment-decline.ts` classifies by code first, then by message, then soft. The table holds only standard ISO 8583 codes of certain meaning and must be checked against the provider's published list before live use.
- Open question 4 above, in part (an abandoned payment): a `payment_abandoned` event whose payment verifies as the attempt's, and a fetched payment that failed with the session-expired message, record the decline, so the payer may start again at once instead of waiting for the attempt's lifetime to end.
- "A payment carries no intent id, so a lookup by attempt needs a payment list filtered by description, which was not tested": a payment list filtered by `metadata[key]` is now the way to find a payment that never reported back. The pay page puts `metadata: { attempt_id }` on the payment and nothing else. The metadata is the browser's, so a listed payment is only a candidate and is verified like any other (fetched with the secret key, intent fulfilled, description, amount, currency, locked callback with its secret). The creation-time filter is applied by us, not sent, because its name was not tried.
- The consent text version the server stores is checked against one list in `packages/commercial-contracts` (`ACCEPTED_CONSENT_TEXT_VERSIONS`); an unknown one is refused with 422 `consent_version_unknown`.

Still for the provider (not closed by code):

1. Whether MOTO (`3ds: false`) is off on the live account, since the intent does not prevent it and the payment object proves no 3-D Secure step.
2. Whether live accounts accept several partial refunds per payment (the sandbox allows exactly one).
3. Whether a declined charge deactivates a saved token in live mode (the sandbox does, after a 3-D Secure failure and after a decline following a successful step).
4. Which PCI self-assessment questionnaire applies to the embedded form.
5. The names of the creation and update time filters of `GET /v1/payments`, and the live `meta` shape of the list (the adapter reads `meta.next_page`).
