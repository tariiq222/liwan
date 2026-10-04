// Moyasar adapter (hosted invoice redirect flow, webhooks, tokens, refunds).
// Webhooks carry only a shared secret_token (no HMAC), so a verified webhook
// is a hint: always run confirmEvent() before changing state.
import { timingSafeEqual } from 'node:crypto'
import {
  PaymentError, assertReturnUrl,
  type AdapterHeaders, type ChargeTokenInput, type CreateAttemptInput, type CreateAttemptResult,
  type Money, type PaymentAdapter, type ProviderEvent, type ProviderEventStatus, type RefundResult, type TokenInfo,
} from './payment-adapter.js'

export type MoyasarConfig = {
  secretKey: string
  webhookSecret: string
  merchantAccount: string
  expectLive: boolean
  allowedReturnOrigins: readonly string[]
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const EXPONENTS: Record<string, number> = { SAR: 2, USD: 2, EUR: 2, AED: 2, KWD: 3, BHD: 3, OMR: 3, JPY: 0 }
export const exponentFor = (currency: string): number => EXPONENTS[currency.toUpperCase()] ?? 2

const WEBHOOK_STATUS: Record<string, ProviderEventStatus> = {
  payment_paid: 'succeeded', payment_captured: 'succeeded', payment_failed: 'failed',
  payment_voided: 'canceled', payment_abandoned: 'canceled', payment_authorized: 'pending',
  payment_verified: 'pending', payment_refunded: 'refunded',
}
const OBJECT_STATUS: Record<string, ProviderEventStatus> = {
  initiated: 'pending', on_hold: 'pending', authorized: 'pending', verified: 'pending',
  paid: 'succeeded', captured: 'succeeded', failed: 'failed', refunded: 'refunded',
  canceled: 'canceled', voided: 'canceled', expired: 'canceled',
}

type Json = Record<string, any>

function money(amount: unknown, currency: unknown): Money {
  if (!Number.isInteger(amount) || (amount as number) < 0 || typeof currency !== 'string' || !currency)
    throw new PaymentError('invalid_event', 'bad amount/currency')
  const c = currency.toUpperCase()
  return { currency: c, exponent: exponentFor(c), minor: amount as number }
}

export class MoyasarAdapter implements PaymentAdapter {
  readonly provider = 'moyasar'
  readonly mode: 'test' | 'live'
  get merchantAccount(): string { return this.cfg.merchantAccount }
  private readonly base: string
  private readonly auth: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly cfg: MoyasarConfig) {
    const key = cfg.secretKey
    if (key.startsWith('sk_live_')) {
      if (!cfg.expectLive) throw new PaymentError('key_mode_mismatch', 'live key requires expectLive=true')
    } else if (key.startsWith('sk_test_')) {
      if (cfg.expectLive) throw new PaymentError('key_mode_mismatch', 'test key with expectLive=true')
    } else throw new PaymentError('provider_not_configured', 'secret key must start with sk_test_ or sk_live_')
    if (!cfg.webhookSecret || !cfg.merchantAccount) throw new PaymentError('provider_not_configured', 'webhook secret/account required')
    this.mode = cfg.expectLive ? 'live' : 'test'
    this.base = (cfg.baseUrl ?? 'https://api.moyasar.com/v1').replace(/\/+$/, '')
    this.auth = 'Basic ' + Buffer.from(`${key}:`).toString('base64')
    this.fetchImpl = cfg.fetchImpl ?? fetch
    this.timeoutMs = cfg.timeoutMs ?? 15000
  }

  private redact(s: string): string {
    return s.split(this.cfg.secretKey).join('[redacted]').split(this.cfg.webhookSecret).join('[redacted]')
  }

  private async call(method: string, path: string, body?: unknown): Promise<Json> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(this.base + path, {
        method,
        headers: { authorization: this.auth, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      })
      const text = await res.text()
      let json: Json = {}
      try { json = text ? JSON.parse(text) : {} } catch { /* non-json */ }
      if (res.status === 404) throw new PaymentError('not_found', path)
      if (!res.ok) throw new PaymentError('provider_error', this.redact(`http ${res.status} ${String(json.message ?? json.type ?? '')}`.trim()))
      return json
    } catch (e) {
      if (e instanceof PaymentError) throw e
      if ((e as Error)?.name === 'AbortError') throw new PaymentError('timeout', path)
      throw new PaymentError('provider_unreachable', this.redact(String((e as Error)?.message ?? e)))
    } finally { clearTimeout(timer) }
  }

  async createAttempt(i: CreateAttemptInput): Promise<CreateAttemptResult> {
    const origins = this.cfg.allowedReturnOrigins
    const success_url = assertReturnUrl(i.success_url, origins)
    const back_url = assertReturnUrl(i.back_url, origins)
    const callback_url = assertReturnUrl(i.callback_url, origins)
    if (!Number.isInteger(i.amount.minor) || i.amount.minor < 100) throw new PaymentError('invalid_amount', 'minimum 100 minor units')
    const inv = await this.call('POST', '/invoices', {
      amount: i.amount.minor, currency: i.amount.currency.toUpperCase(), description: i.description,
      callback_url, success_url, back_url,
      ...(i.expires_at ? { expired_at: i.expires_at } : {}),
      metadata: { attempt_id: i.attempt_id, order_id: i.order_id },
    })
    if (typeof inv.id !== 'string' || typeof inv.url !== 'string') throw new PaymentError('provider_error', 'malformed invoice response')
    return { provider_ref: inv.id, redirect_url: inv.url, status: OBJECT_STATUS[inv.status] ?? 'pending' }
  }

  verifyEvent(rawBody: Uint8Array, _headers: AdapterHeaders = {}): ProviderEvent {
    let p: Json
    try { p = JSON.parse(new TextDecoder().decode(rawBody)) } catch { throw new PaymentError('invalid_event', 'not json') }
    if (!p || typeof p !== 'object') throw new PaymentError('invalid_event', 'not an object')
    const got = Buffer.from(String(p.secret_token ?? ''))
    const want = Buffer.from(this.cfg.webhookSecret)
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new PaymentError('signature_invalid')
    if (p.account_name !== this.cfg.merchantAccount) throw new PaymentError('merchant_mismatch')
    if (p.live !== this.cfg.expectLive) throw new PaymentError('mode_mismatch')
    const status = WEBHOOK_STATUS[String(p.type)]
    const d = p.data as Json
    if (!status || typeof p.id !== 'string' || !d || typeof d.id !== 'string') throw new PaymentError('invalid_event', 'unknown type or shape')
    return {
      provider: 'moyasar', event_id: p.id,
      provider_ref: typeof d.invoice_id === 'string' && d.invoice_id ? d.invoice_id : d.id,
      payment_id: d.id,
      attempt_id: typeof d.metadata?.attempt_id === 'string' ? d.metadata.attempt_id : null,
      merchant_account: p.account_name, live: p.live, status,
      amount: money(d.amount, d.currency),
      occurred_at: typeof p.created_at === 'string' ? p.created_at : new Date().toISOString(),
      raw_type: p.type,
    }
  }

  private fromInvoice(inv: Json): ProviderEvent {
    const payments: Json[] = Array.isArray(inv.payments) ? inv.payments : []
    const paid = payments.find(x => x.status === 'paid' || x.status === 'captured')
    const pay = paid ?? payments[payments.length - 1]
    return {
      provider: 'moyasar', event_id: `lookup:${inv.id}:${inv.status}`,
      provider_ref: inv.id, payment_id: pay?.id ?? null,
      attempt_id: typeof inv.metadata?.attempt_id === 'string' ? inv.metadata.attempt_id : null,
      merchant_account: this.cfg.merchantAccount, live: this.cfg.expectLive,
      status: OBJECT_STATUS[String(inv.status)] ?? 'pending',
      amount: money(inv.amount, inv.currency),
      occurred_at: String(inv.updated_at ?? inv.created_at ?? new Date().toISOString()),
      raw_type: `invoice_${inv.status}`,
    }
  }

  private fromPayment(p: Json): ProviderEvent {
    return {
      provider: 'moyasar', event_id: `lookup:${p.id}:${p.status}`,
      provider_ref: typeof p.invoice_id === 'string' && p.invoice_id ? p.invoice_id : p.id, payment_id: p.id,
      attempt_id: typeof p.metadata?.attempt_id === 'string' ? p.metadata.attempt_id : null,
      merchant_account: this.cfg.merchantAccount, live: this.cfg.expectLive,
      status: OBJECT_STATUS[String(p.status)] ?? 'pending',
      amount: money(p.amount, p.currency),
      occurred_at: String(p.updated_at ?? p.created_at ?? new Date().toISOString()),
      raw_type: `payment_${p.status}`,
    }
  }

  async lookupAttempt(providerRef: string): Promise<ProviderEvent> {
    const inv = await this.call('GET', `/invoices/${encodeURIComponent(providerRef)}`)
    if (inv.id !== providerRef) throw new PaymentError('event_mismatch', 'invoice id differs')
    return this.fromInvoice(inv)
  }

  async lookupPayment(paymentId: string): Promise<ProviderEvent> {
    return this.fromPayment(await this.call('GET', `/payments/${encodeURIComponent(paymentId)}`))
  }

  async lookupByAttemptId(attemptId: string): Promise<ProviderEvent | null> {
    const r = await this.call('GET', `/invoices?metadata[attempt_id]=${encodeURIComponent(attemptId)}`)
    const inv = (Array.isArray(r.invoices) ? r.invoices : []).find((x: Json) => x.metadata?.attempt_id === attemptId)
    return inv ? this.fromInvoice(inv) : null
  }

  async cancelAttempt(providerRef: string): Promise<void> {
    await this.call('PUT', `/invoices/${encodeURIComponent(providerRef)}/cancel`)
  }

  async refund(paymentRef: string, amount?: Money): Promise<RefundResult> {
    const p = await this.call('POST', `/payments/${encodeURIComponent(paymentRef)}/refund`, amount ? { amount: amount.minor } : {})
    return {
      payment_id: String(p.id ?? paymentRef), status: OBJECT_STATUS[String(p.status)] ?? 'pending',
      refunded: money(Number.isInteger(p.refunded) ? p.refunded : (amount?.minor ?? p.amount), p.currency ?? amount?.currency ?? 'SAR'),
    }
  }

  async chargeToken(i: ChargeTokenInput): Promise<ProviderEvent> {
    const tok = await this.getToken(i.token)
    if (!tok.active) throw new PaymentError('provider_error', 'token not active')
    const callback_url = assertReturnUrl(i.callback_url, this.cfg.allowedReturnOrigins)
    const p = await this.call('POST', '/payments', {
      amount: i.amount.minor, currency: i.amount.currency.toUpperCase(), callback_url,
      given_id: i.given_id, description: i.description, source: { type: 'token', token: i.token },
    })
    return this.fromPayment(p)
  }

  async getToken(id: string): Promise<TokenInfo> {
    const t = await this.call('GET', `/tokens/${encodeURIComponent(id)}`)
    return { id: String(t.id ?? id), status: String(t.status), active: t.status === 'active' }
  }

  async deleteToken(id: string): Promise<void> { await this.call('DELETE', `/tokens/${encodeURIComponent(id)}`) }
}

/** Authoritative re-check of a verified webhook; returns provider-fetched state. */
export async function confirmEvent(adapter: PaymentAdapter, event: ProviderEvent): Promise<ProviderEvent> {
  const auth = await adapter.lookupAttempt(event.provider_ref)
  if (auth.provider !== adapter.provider || event.provider !== adapter.provider
    || auth.merchant_account !== adapter.merchantAccount || event.merchant_account !== adapter.merchantAccount
    || auth.live !== (adapter.mode === 'live') || event.live !== (adapter.mode === 'live')
    || auth.provider_ref !== event.provider_ref
    || auth.amount.exponent !== event.amount.exponent
    || auth.amount.currency !== event.amount.currency
    || auth.amount.minor !== event.amount.minor
    || (event.attempt_id && auth.attempt_id && auth.attempt_id !== event.attempt_id)
    || (event.payment_id && auth.payment_id && auth.payment_id !== event.payment_id && event.status === 'succeeded' && auth.status === 'succeeded'))
    throw new PaymentError('event_mismatch')
  return auth
}
