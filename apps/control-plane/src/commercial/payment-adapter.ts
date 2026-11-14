// Payment-provider adapter contract for the LiwanOS control plane. Provider
// events are never trusted on their own: callers must confirm them with an
// authoritative provider fetch (see confirmEvent in moyasar-adapter.ts).
// Types are local; the coordinator aligns them with shared contracts later.
import type { PaymentAttemptKind } from '@liwan/commercial-contracts'
import { MoyasarAdapter } from './moyasar-adapter.js'
import { SimulatorAdapter } from './payment-simulator.js'

export type Money = { currency: string; exponent: number; minor: number }

/** The error `type` the provider's API answers with, which the adapter uses as the error code (docs/operations/moyasar-form-spike.md). */
export const PROVIDER_ERROR_TYPES = [
  'used_given_id', 'intent_not_fulfillable', 'intent_not_cancelable', 'invalid_client_secret',
  'validation_error', 'invalid_request', 'invalid_request_error',
] as const
export type ProviderErrorType = typeof PROVIDER_ERROR_TYPES[number]

export type PaymentErrorCode =
  | 'signature_invalid' | 'merchant_mismatch' | 'mode_mismatch' | 'event_mismatch'
  | 'return_url_forbidden' | 'provider_not_configured' | 'provider_forbidden'
  | 'invalid_event' | 'invalid_amount' | 'timeout' | 'provider_unreachable' | 'provider_error'
  | 'not_found' | 'key_mode_mismatch' | ProviderErrorType

export class PaymentError extends Error {
  /** `httpStatus` is the provider's answer when there was one; it is never part of the message a caller shows. */
  constructor(readonly code: PaymentErrorCode, message?: string, readonly httpStatus?: number) {
    super(message ? `${code}: ${message}` : code)
    this.name = 'PaymentError'
  }
}

export type ProviderEventStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'canceled'

export type ProviderEvent = {
  provider: string
  event_id: string
  provider_ref: string // invoice id (or payment id for direct charges)
  payment_id: string | null
  attempt_id: string | null
  merchant_account: string
  live: boolean
  status: ProviderEventStatus
  amount: Money
  /** Total the provider has refunded on this payment so far (cumulative, never a single refund). Absent means the provider gave no figure, and a refund without one is rejected for the operator, not assumed whole. */
  refunded?: Money
  occurred_at: string
  raw_type: string
  simulated?: boolean
  /** The provider's reason for a failed payment (`source.message`), when it gave one: what classifies a decline learned through a lookup or a webhook. */
  decline_message?: string | null
}

/** What a `refunded` event refunded: the provider's cumulative figure, or null when it gave none (never assumed to be the whole payment). */
export const refundedAmount = (event: ProviderEvent): Money | null => event.refunded ?? null

export type CreateAttemptInput = {
  attempt_id: string
  order_id: string
  amount: Money
  description: string
  success_url: string
  back_url: string
  callback_url: string
  expires_at?: string
}
export type CreateAttemptResult = { provider_ref: string; redirect_url: string; status: ProviderEventStatus }

/** The smallest refund the provider accepts, in minor units (1.00 SAR; sandbox finding, unverified on a live account). */
export const MIN_REFUND_MINOR = 100
/** The provider's published minimum for any payment: a smaller invoice is never sent to the card (the adapter's `createAttempt` and `createIntent` refuse it too). */
export const MIN_CHARGE_MINOR = 100
/**
 * What a refund call came to. The provider accepts ONE refund per payment: a partial refund already moves the payment to
 * `refunded`, and any later call is refused (`already_refunded`). `refunded` is the provider's cumulative figure.
 */
export type RefundOutcome =
  | { outcome: 'refunded'; payment_id: string; status: ProviderEventStatus; refunded: Money }
  | { outcome: 'already_refunded' }
  | { outcome: 'below_minimum' }

/**
 * `expired`: a `created` intent past its `expires_at`. The provider was observed to answer only `created`, `fulfilled` and `canceled` (spike U9),
 * so the adapters derive this one: an intent nobody fulfilled before its end holds no payment and can never get one.
 */
export type IntentStatus = 'created' | 'fulfilled' | 'canceled' | 'expired' | 'unrecognized'
/** The status an intent has now: a `created` one past its end is `expired`, whatever the provider still calls it. */
export const intentStatusAt = (status: Exclude<IntentStatus, 'expired'>, expiresAt: string, now = Date.now()): IntentStatus =>
  status === 'created' && Date.parse(expiresAt) <= now ? 'expired' : status
/** A payment intent: the server-locked amount, currency, description and callback URL a browser may only fulfil. `client_secret` goes to that browser and nowhere else. */
export type PaymentIntent = {
  id: string
  client_secret: string
  status: IntentStatus
  expires_at: string
  amount: Money
  description: string
  callback_url: string
}
/** The description is not an input: the adapter builds it from the attempt id, so the attempt identity cannot be left out or forged. */
export type CreateIntentInput = { attempt_id: string; amount: Money; callback_url: string }
/** `not_cancelable`: the intent is already fulfilled or canceled, so nothing was changed. */
export type IntentCancelOutcome = 'canceled' | 'not_cancelable'

/**
 * A payment as the provider reports it, read with the secret key, with everything verification needs. Nothing in it comes from the
 * browser except what the provider itself locked (see payment-description.ts).
 */
export type PaymentRecord = {
  payment_id: string
  status: ProviderEventStatus
  /** The provider's own status word (`initiated`, `paid`, `failed`, `refunded`, `voided`, ...). */
  provider_status: string
  amount: Money
  /** Cumulative refunded amount; null when none. After a partial refund the status is `refunded` with a figure below `amount`. */
  refunded: Money | null
  description: string | null
  /** The attempt the locked description names, or null when the description is not one the adapter built. */
  attempt_id: string | null
  callback_url: string | null
  /** The mode of the key that read it: the provider's payment object carries no live/test flag. */
  live: boolean
  invoice_id: string | null
  /** `source.token`: present on a payment that saved a card (and absent on a payment made with a saved card). */
  token: string | null
  /**
   * Whether the payer passed 3-D Secure. The sandbox spike found no payment field that says so (a client may ask for `3ds: false`
   * and the test account then pays unauthenticated), so this is null until the provider documents one; never guessed.
   */
  authenticated: boolean | null
  /** `source.message` of a failed payment (upper-case text in the sandbox); null otherwise. */
  decline_message: string | null
}

export type TokenStatus = 'initiated' | 'active' | 'inactive' | 'save_only' | 'unrecognized'
/** A saved card's display facts and state. A field the provider did not send is null. Never holds a number, a security code or a holder name. */
export type TokenInfo = {
  id: string
  status: TokenStatus
  /** Only `active` can be charged without the customer. */
  active: boolean
  brand: string | null
  last_four: string | null
  exp_month: number | null
  exp_year: number | null
  funding: string | null
}

/**
 * `given_id` is the provider's idempotency key for the charge and is chosen by the caller; the provider burns it when the payment
 * fails, so a retry needs a new one.
 */
export type ChargeTokenInput = { given_id: string; token: string; amount: Money; description: string; callback_url: string }
/**
 * What charging a saved token came to. `needs_customer_action` is a payment waiting for the payer (a `save_only` token or a forced
 * 3-D Secure step) and is never a pending payment: nobody is going to finish it. The step's URL is deliberately not surfaced.
 * `unknown`: the call may or may not have charged (timeout, no connection, a 5xx); reconcile by `given_id`, never retry blindly.
 */
export type ChargeTokenOutcome =
  | { outcome: 'paid'; payment: PaymentRecord }
  | { outcome: 'declined'; payment: PaymentRecord; message: string | null }
  | { outcome: 'needs_customer_action'; payment: PaymentRecord }
  | { outcome: 'token_unusable' }
  | { outcome: 'unknown'; reason: 'timeout' | 'provider_unreachable' | 'provider_server_error' }

/** The one-time code the provider sends when a webhook is registered; it must reach the operator, who types it into the provider's dashboard. */
export type WebhookVerification = {
  webhook_id: string
  code: string
  /** False when the event did not carry the shared secret: it is then a hint for the operator, never a fact. */
  authenticated: boolean
  occurred_at: string
}

/**
 * A form payment and a saved-card charge are direct payments: the provider reference is a payment id, read with `lookupPayment`.
 * Only a hosted invoice has an invoice id that `lookupAttempt` reads.
 */
export const isDirectPayment = (kind: PaymentAttemptKind): boolean => kind === 'form' || kind === 'saved_card'
export type AdapterHeaders = Record<string, string | string[] | undefined>

export interface PaymentAdapter {
  readonly provider: string
  readonly merchantAccount: string
  readonly mode: 'test' | 'live' | 'simulator'
  /** Public by design: the browser needs it to fulfil an intent. Never the secret key. Null when the deployment has none (card payments through the form are then off). */
  readonly publishableKey: string | null
  createAttempt(input: CreateAttemptInput): Promise<CreateAttemptResult>
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>
  /** Reads an intent with the secret key; `client_secret` can be read again at any time. */
  getIntent(intentId: string): Promise<PaymentIntent>
  cancelIntent(intentId: string): Promise<IntentCancelOutcome>
  verifyEvent(rawBody: Uint8Array, headers: AdapterHeaders): ProviderEvent
  /** The registration code event, or null when the body is any other event. Throws when it fails the same checks a payment event does. */
  webhookVerification(rawBody: Uint8Array, headers: AdapterHeaders): WebhookVerification | null
  lookupAttempt(providerRef: string): Promise<ProviderEvent>
  lookupByAttemptId?(attemptId: string): Promise<ProviderEvent | null>
  /** Looks up a direct (token) charge by its payment id; invoice lookups cannot see those. */
  lookupPayment?(paymentId: string): Promise<ProviderEvent>
  cancelAttempt?(providerRef: string): Promise<void>
  /** Reads a payment with everything verification needs; the sibling of `lookupPayment`, which keeps the event shape settlement uses. */
  readPayment(paymentId: string): Promise<PaymentRecord>
  refund(paymentRef: string, amount?: Money): Promise<RefundOutcome>
  chargeToken(input: ChargeTokenInput): Promise<ChargeTokenOutcome>
  getToken(id: string): Promise<TokenInfo>
  /** Deleting a token that is already gone succeeds. */
  deleteToken(id: string): Promise<void>
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|[^/]+\.test)$/i

/**
 * An allowlist entry is an exact origin, or `scheme://*.suffix[:port]` for every host below a suffix that has
 * at least two labels (so `https://*.com` matches nothing).
 */
export function originAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some(entry => {
    if (entry === origin) return true
    const wildcard = /^(https?:\/\/)\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?)$/i.exec(entry)
    if (!wildcard) return false
    let u: URL
    try { u = new URL(origin) } catch { return false }
    return `${u.protocol}//` === wildcard[1]!.toLowerCase() && u.host.endsWith(`.${wildcard[2]!.toLowerCase()}`)
  })
}

/** https only, or http for localhost/127.0.0.1/*.test; origin must be allowlisted. */
export function assertReturnUrl(url: string, allowedOrigins: readonly string[]): string {
  let u: URL
  try { u = new URL(url) } catch { throw new PaymentError('return_url_forbidden', 'unparseable url') }
  const okScheme = u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOST.test(u.hostname))
  if (!okScheme || u.username || u.password || !originAllowed(u.origin, allowedOrigins))
    throw new PaymentError('return_url_forbidden', u.origin)
  return u.toString()
}

export function toBytes(raw: Uint8Array | string): Uint8Array {
  return typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
}

/** The floor every service key in config.ts already enforces; the webhook secret is the only defence of the public event route. */
export const MIN_WEBHOOK_SECRET_BYTES = 32

export function paymentAdapterFromEnv(env: Record<string, string | undefined>): PaymentAdapter {
  const provider = env.LIWAN_PAYMENT_PROVIDER
  const need = (k: string): string => {
    const v = env[k]
    if (!v) throw new PaymentError('provider_not_configured', `missing ${k}`)
    return v
  }
  if (provider === 'simulator') {
    if (env.NODE_ENV === 'production') throw new PaymentError('provider_forbidden', 'simulator disabled in production')
    return new SimulatorAdapter({ env })
  }
  if (provider === 'moyasar') {
    const mode = need('MOYASAR_MODE')
    if (mode !== 'test' && mode !== 'live') throw new PaymentError('provider_not_configured', 'MOYASAR_MODE must be test|live')
    const webhookSecret = need('MOYASAR_WEBHOOK_SECRET')
    if (Buffer.byteLength(webhookSecret) < MIN_WEBHOOK_SECRET_BYTES) throw new PaymentError('provider_not_configured', `MOYASAR_WEBHOOK_SECRET must contain at least ${MIN_WEBHOOK_SECRET_BYTES} bytes`)
    return new MoyasarAdapter({
      secretKey: need('MOYASAR_SECRET_KEY'),
      ...(env.MOYASAR_PUBLISHABLE_KEY ? { publishableKey: env.MOYASAR_PUBLISHABLE_KEY } : {}),
      webhookRegistrationOpen: env.MOYASAR_WEBHOOK_REGISTRATION === 'open',
      webhookSecret,
      merchantAccount: need('MOYASAR_ACCOUNT_NAME'),
      expectLive: mode === 'live',
      allowedReturnOrigins: need('LIWAN_PAYMENT_RETURN_ORIGINS').split(',').map(s => s.trim()).filter(Boolean),
    })
  }
  throw new PaymentError('provider_not_configured', 'LIWAN_PAYMENT_PROVIDER must be moyasar|simulator')
}
