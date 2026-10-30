// Payment-provider adapter contract for the LiwanOS control plane. Provider
// events are never trusted on their own: callers must confirm them with an
// authoritative provider fetch (see confirmEvent in moyasar-adapter.ts).
// Types are local; the coordinator aligns them with shared contracts later.
import { MoyasarAdapter } from './moyasar-adapter.js'
import { SimulatorAdapter } from './payment-simulator.js'

export type Money = { currency: string; exponent: number; minor: number }

export type PaymentErrorCode =
  | 'signature_invalid' | 'merchant_mismatch' | 'mode_mismatch' | 'event_mismatch'
  | 'return_url_forbidden' | 'provider_not_configured' | 'provider_forbidden'
  | 'invalid_event' | 'invalid_amount' | 'timeout' | 'provider_unreachable' | 'provider_error'
  | 'not_found' | 'key_mode_mismatch'

export class PaymentError extends Error {
  constructor(readonly code: PaymentErrorCode, message?: string) {
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
  occurred_at: string
  raw_type: string
  simulated?: boolean
}

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
export type RefundResult = { payment_id: string; status: ProviderEventStatus; refunded: Money }
export type ChargeTokenInput = { given_id: string; token: string; amount: Money; description: string; callback_url: string }
export type TokenInfo = { id: string; status: string; active: boolean }
export type AdapterHeaders = Record<string, string | string[] | undefined>

export interface PaymentAdapter {
  readonly provider: string
  readonly merchantAccount: string
  readonly mode: 'test' | 'live' | 'simulator'
  createAttempt(input: CreateAttemptInput): Promise<CreateAttemptResult>
  verifyEvent(rawBody: Uint8Array, headers: AdapterHeaders): ProviderEvent
  lookupAttempt(providerRef: string): Promise<ProviderEvent>
  lookupByAttemptId?(attemptId: string): Promise<ProviderEvent | null>
  /** Looks up a direct (token) charge by its payment id; invoice lookups cannot see those. */
  lookupPayment?(paymentId: string): Promise<ProviderEvent>
  cancelAttempt?(providerRef: string): Promise<void>
  refund(paymentRef: string, amount?: Money): Promise<RefundResult>
  chargeToken(input: ChargeTokenInput): Promise<ProviderEvent>
  getToken(id: string): Promise<TokenInfo>
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
    return new MoyasarAdapter({
      secretKey: need('MOYASAR_SECRET_KEY'),
      webhookSecret: need('MOYASAR_WEBHOOK_SECRET'),
      merchantAccount: need('MOYASAR_ACCOUNT_NAME'),
      expectLive: mode === 'live',
      allowedReturnOrigins: need('LIWAN_PAYMENT_RETURN_ORIGINS').split(',').map(s => s.trim()).filter(Boolean),
    })
  }
  throw new PaymentError('provider_not_configured', 'LIWAN_PAYMENT_PROVIDER must be moyasar|simulator')
}
