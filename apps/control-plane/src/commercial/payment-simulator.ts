// Deterministic in-memory provider for local/unit tests. Never usable in
// production or with live config. Events are flagged simulated:true.
// State is process-local: the worker's reconcileUnknownAttempts uses its own
// adapter and cannot see API-side attempts/settlement. Local acceptance settles
// synchronously through the API's shared adapter and normal webhook handler.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  PaymentError, toBytes,
  type AdapterHeaders, type ChargeTokenInput, type CreateAttemptInput, type CreateAttemptResult,
  type Money, type PaymentAdapter, type ProviderEvent, type ProviderEventStatus, type RefundResult, type TokenInfo,
} from './payment-adapter.js'

export type SimOutcome = 'succeed' | 'fail' | 'cancel' | 'timeout'
export type SimulatorConfig = {
  env?: Record<string, string | undefined>
  live?: boolean
  merchantAccount?: string
  webhookSecret?: string
  defaultOutcome?: SimOutcome
}
type SimAttempt = { input: CreateAttemptInput; ref: string; payment_id: string; status: ProviderEventStatus; outcome: SimOutcome }
export type WebhookOverrides = {
  status?: ProviderEventStatus; amount?: Money; merchant?: string; secret?: string; eventId?: string; live?: boolean
}
const TYPE: Record<ProviderEventStatus, string> = {
  succeeded: 'payment_paid', failed: 'payment_failed', canceled: 'payment_voided', refunded: 'payment_refunded', pending: 'payment_authorized',
}
const FINAL: Record<SimOutcome, ProviderEventStatus> = { succeed: 'succeeded', fail: 'failed', cancel: 'canceled', timeout: 'pending' }

export class SimulatorAdapter implements PaymentAdapter {
  readonly provider = 'simulator'
  readonly mode = 'simulator' as const
  readonly merchantAccount: string
  readonly webhookSecret: string
  private readonly outcomes = new Map<string, SimOutcome>()
  private readonly attempts = new Map<string, SimAttempt>()
  private readonly byAttempt = new Map<string, SimAttempt>()
  private readonly tokens = new Map<string, string>()
  private readonly charges = new Map<string, ProviderEvent>()
  private seq = 0
  // References must stay unique across restarts: payment_attempts keeps every earlier ref.
  private readonly instance = randomBytes(4).toString('hex')
  private readonly defaultOutcome: SimOutcome

  constructor(cfg: SimulatorConfig = {}) {
    const env = cfg.env ?? process.env
    if (env.NODE_ENV === 'production' || cfg.live || env.MOYASAR_MODE === 'live')
      throw new PaymentError('provider_forbidden', 'simulator is not selectable in production/live')
    this.merchantAccount = cfg.merchantAccount ?? 'sim-merchant'
    this.webhookSecret = cfg.webhookSecret ?? 'sim-webhook-secret'
    this.defaultOutcome = cfg.defaultOutcome ?? 'succeed'
  }

  /** Script the outcome for an attempt_id before createAttempt. */
  script(attemptId: string, outcome: SimOutcome): this { this.outcomes.set(attemptId, outcome); return this }
  addToken(id: string, status = 'active'): this { this.tokens.set(id, status); return this }

  async createAttempt(i: CreateAttemptInput): Promise<CreateAttemptResult> {
    const existing = this.byAttempt.get(i.attempt_id)
    if (existing) return { provider_ref: existing.ref, redirect_url: `https://sim.test/pay/${existing.ref}`, status: 'pending' }
    const n = ++this.seq
    const a: SimAttempt = {
      input: i, ref: `sim_inv_${this.instance}_${n}`, payment_id: `sim_pay_${this.instance}_${n}`, status: 'pending',
      outcome: this.outcomes.get(i.attempt_id) ?? this.defaultOutcome,
    }
    this.attempts.set(a.ref, a); this.byAttempt.set(i.attempt_id, a)
    if (a.outcome === 'timeout') throw new PaymentError('timeout', 'simulated timeout (attempt recorded)')
    return { provider_ref: a.ref, redirect_url: `https://sim.test/pay/${a.ref}`, status: 'pending' }
  }

  /** Complete explicitly, or use the scripted outcome; webhookBody and lookup agree. */
  settle(ref: string, outcome?: 'succeeded' | 'failed' | 'canceled'): ProviderEvent {
    const a = this.need(ref)
    a.status = outcome ?? FINAL[a.outcome]
    return this.eventFor(a, a.status)
  }

  private need(ref: string): SimAttempt {
    const a = this.attempts.get(ref)
    if (!a) throw new PaymentError('not_found', ref)
    return a
  }

  private eventFor(a: SimAttempt, status: ProviderEventStatus, o: WebhookOverrides = {}): ProviderEvent {
    return {
      provider: 'simulator', event_id: o.eventId ?? `sim_evt_${a.ref}_${status}`,
      provider_ref: a.ref, payment_id: a.payment_id, attempt_id: a.input.attempt_id,
      merchant_account: o.merchant ?? this.merchantAccount, live: o.live ?? false, status,
      amount: o.amount ?? a.input.amount, occurred_at: new Date(Date.UTC(2026, 0, 1, 0, 0, this.seq)).toISOString(),
      raw_type: TYPE[status], simulated: true,
    }
  }

  /** Build a raw webhook body for verifyEvent. Overrides inject faults (wrong amount/merchant/secret...). */
  webhookBody(ref: string, o: WebhookOverrides = {}): Uint8Array {
    const a = this.need(ref)
    const status = o.status ?? (a.status === 'pending' ? FINAL[a.outcome] : a.status)
    const ev = this.eventFor(a, status, o)
    return toBytes(JSON.stringify({
      id: ev.event_id, type: ev.raw_type, created_at: ev.occurred_at, secret_token: o.secret ?? this.webhookSecret,
      account_name: ev.merchant_account, live: ev.live, simulated: true,
      data: { id: a.payment_id, invoice_id: a.ref, status, amount: ev.amount.minor, currency: ev.amount.currency, metadata: { attempt_id: a.input.attempt_id } },
    }))
  }

  /** Duplicate delivery: same body twice. */
  duplicateBodies(ref: string): [Uint8Array, Uint8Array] { const b = this.webhookBody(ref); return [b, b] }
  /** Out-of-order: [succeeded, then a stale pending event with a different id]. */
  outOfOrderBodies(ref: string): [Uint8Array, Uint8Array] {
    return [this.webhookBody(ref, { status: 'succeeded' }), this.webhookBody(ref, { status: 'pending', eventId: `sim_evt_${ref}_late_pending` })]
  }

  verifyEvent(rawBody: Uint8Array, _h: AdapterHeaders = {}): ProviderEvent {
    let p: any
    try { p = JSON.parse(new TextDecoder().decode(rawBody)) } catch { throw new PaymentError('invalid_event') }
    const got = Buffer.from(String(p?.secret_token ?? '')); const want = Buffer.from(this.webhookSecret)
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new PaymentError('signature_invalid')
    if (p.account_name !== this.merchantAccount) throw new PaymentError('merchant_mismatch')
    if (p.live !== false) throw new PaymentError('mode_mismatch')
    const d = p.data
    return {
      provider: 'simulator', event_id: p.id, provider_ref: d.invoice_id, payment_id: d.id,
      attempt_id: d.metadata?.attempt_id ?? null, merchant_account: p.account_name, live: p.live,
      status: d.status as ProviderEventStatus,
      amount: { currency: d.currency, exponent: 2, minor: d.amount }, occurred_at: p.created_at, raw_type: p.type, simulated: true,
    }
  }

  async lookupAttempt(ref: string): Promise<ProviderEvent> {
    const a = this.need(ref) // like the real invoice endpoint, a token charge's payment id is unknown here
    return { ...this.eventFor(a, a.status), event_id: `sim_lookup_${a.ref}_${a.status}` }
  }
  async lookupPayment(paymentId: string): Promise<ProviderEvent> {
    const charge = [...this.charges.values()].find(event => event.payment_id === paymentId)
    if (!charge) throw new PaymentError('not_found', paymentId)
    return { ...charge, event_id: `sim_lookup_${paymentId}_${charge.status}` }
  }
  async lookupByAttemptId(attemptId: string): Promise<ProviderEvent | null> {
    const a = this.byAttempt.get(attemptId)
    return a ? this.lookupAttempt(a.ref) : null
  }

  async cancelAttempt(providerRef: string): Promise<void> {
    this.need(providerRef).status = 'canceled'
  }

  async refund(paymentRef: string, amount?: Money): Promise<RefundResult> {
    const a = [...this.attempts.values()].find(x => x.payment_id === paymentRef)
    if (!a) throw new PaymentError('not_found', paymentRef)
    if (a.status !== 'succeeded') throw new PaymentError('provider_error', 'payment not paid')
    const refunded = amount ?? a.input.amount
    if (refunded.minor > a.input.amount.minor) throw new PaymentError('invalid_amount')
    if (refunded.minor === a.input.amount.minor) a.status = 'refunded'
    return { payment_id: paymentRef, status: 'refunded', refunded }
  }

  async chargeToken(i: ChargeTokenInput): Promise<ProviderEvent> {
    const prior = this.charges.get(i.given_id)
    if (prior) return prior
    if (!(await this.getToken(i.token)).active) throw new PaymentError('provider_error', 'token not active')
    const ev: ProviderEvent = {
      provider: 'simulator', event_id: `sim_charge_${i.given_id}`, provider_ref: `sim_pay_${i.given_id}`, payment_id: `sim_pay_${i.given_id}`,
      attempt_id: null, merchant_account: this.merchantAccount, live: false, status: 'succeeded', amount: i.amount,
      occurred_at: new Date(0).toISOString(), raw_type: 'payment_paid', simulated: true,
    }
    this.charges.set(i.given_id, ev)
    return ev
  }

  async getToken(id: string): Promise<TokenInfo> {
    const s = this.tokens.get(id)
    if (!s) throw new PaymentError('not_found', id)
    return { id, status: s, active: s === 'active' }
  }
}
