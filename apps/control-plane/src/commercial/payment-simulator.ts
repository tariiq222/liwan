// Deterministic in-memory provider for local/unit tests. Never usable in
// production or with live config. Events are flagged simulated:true.
// State is process-local: the worker's reconcileUnknownAttempts uses its own
// adapter and cannot see API-side attempts/settlement. Local acceptance settles
// synchronously through the API's shared adapter and normal webhook handler.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  MIN_REFUND_MINOR, PaymentError, toBytes,
  type AdapterHeaders, type ChargeTokenInput, type ChargeTokenOutcome, type CreateAttemptInput, type CreateAttemptResult, type CreateIntentInput,
  type IntentCancelOutcome, type Money, type PaymentAdapter, type PaymentIntent, type PaymentRecord, type ProviderEvent, type ProviderEventStatus,
  type RefundOutcome, type TokenInfo, type TokenStatus, type WebhookVerification,
} from './payment-adapter.js'
import { buildAttemptDescription, parseAttemptDescription } from './payment-description.js'

export type SimOutcome = 'succeed' | 'fail' | 'cancel' | 'timeout'
export type SimulatorConfig = {
  env?: Record<string, string | undefined>
  live?: boolean
  merchantAccount?: string
  webhookSecret?: string
  /** Like MOYASAR_WEBHOOK_REGISTRATION=open: a registration event without the shared secret is accepted. */
  webhookRegistrationOpen?: boolean
  defaultOutcome?: SimOutcome
}
type SimAttempt = { input: CreateAttemptInput; ref: string; payment_id: string; status: ProviderEventStatus; outcome: SimOutcome; refunded: number }
export type WebhookOverrides = {
  status?: ProviderEventStatus; amount?: Money; merchant?: string; secret?: string; eventId?: string; live?: boolean
}
const TYPE: Record<ProviderEventStatus, string> = {
  succeeded: 'payment_paid', failed: 'payment_failed', canceled: 'payment_voided', refunded: 'payment_refunded', pending: 'payment_authorized',
}
const FINAL: Record<SimOutcome, ProviderEventStatus> = { succeed: 'succeeded', fail: 'failed', cancel: 'canceled', timeout: 'pending' }
const PROVIDER_STATUS: Record<ProviderEventStatus, string> = { succeeded: 'paid', failed: 'failed', canceled: 'voided', refunded: 'refunded', pending: 'initiated' }

type SimToken = { status: TokenStatus; brand: string; last_four: string; exp_month: number; exp_year: number; funding: string }
const DEFAULT_CARD = { brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, funding: 'credit' }
type SimIntent = PaymentIntent & { fulfilled: boolean }
/** What a scripted card does when the browser fulfils an intent or a saved token is charged. */
export type SimCardOutcome = { outcome: 'paid' } | { outcome: 'declined'; message: string } | { outcome: 'needs_customer_action' } | { outcome: 'unknown' }
  /** The provider refuses the token (any state), or has already used the `given_id` of an earlier payment (which then exists). */
  | { outcome: 'token_unusable' } | { outcome: 'used_given_id'; thenPaid?: boolean }
export type FulfilIntentInput = { clientSecret: string; saveCard?: boolean; card?: Extract<SimCardOutcome, { outcome: 'paid' | 'declined' | 'needs_customer_action' | 'unknown' }> }
export type SimVerificationOverrides = { secret?: string | null; merchant?: string; live?: boolean }

export class SimulatorAdapter implements PaymentAdapter {
  readonly provider = 'simulator'
  readonly mode = 'simulator' as const
  readonly merchantAccount: string
  readonly webhookSecret: string
  readonly publishableKey = 'pk_test_simulator'
  private readonly registrationOpen: boolean
  private readonly outcomes = new Map<string, SimOutcome>()
  private readonly attempts = new Map<string, SimAttempt>()
  private readonly byAttempt = new Map<string, SimAttempt>()
  private readonly tokens = new Map<string, SimToken>()
  private readonly tokenCharges = new Map<string, SimCardOutcome>()
  private readonly intents = new Map<string, SimIntent>()
  /** Direct payments (an intent fulfilled by the browser, a saved-token charge), by payment id. */
  private readonly payments = new Map<string, PaymentRecord>()
  private readonly charges = new Map<string, { amount: Money; outcome: ChargeTokenOutcome }>()
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
    this.registrationOpen = cfg.webhookRegistrationOpen ?? false
    this.defaultOutcome = cfg.defaultOutcome ?? 'succeed'
  }

  /** Script the outcome for an attempt_id before createAttempt. */
  script(attemptId: string, outcome: SimOutcome): this { this.outcomes.set(attemptId, outcome); return this }
  addToken(id: string, status: TokenStatus = 'active', card: Partial<Omit<SimToken, 'status'>> = {}): this { this.tokens.set(id, { status, ...DEFAULT_CARD, ...card }); return this }
  /** Script what charging this saved token comes to (default: paid). */
  scriptTokenCharge(tokenId: string, outcome: SimCardOutcome): this { this.tokenCharges.set(tokenId, outcome); return this }

  async createAttempt(i: CreateAttemptInput): Promise<CreateAttemptResult> {
    const existing = this.byAttempt.get(i.attempt_id)
    if (existing) return { provider_ref: existing.ref, redirect_url: `https://sim.test/pay/${existing.ref}`, status: 'pending' }
    const n = ++this.seq
    const a: SimAttempt = {
      input: i, ref: `sim_inv_${this.instance}_${n}`, payment_id: `sim_pay_${this.instance}_${n}`, status: 'pending',
      outcome: this.outcomes.get(i.attempt_id) ?? this.defaultOutcome, refunded: 0,
    }
    this.attempts.set(a.ref, a); this.byAttempt.set(i.attempt_id, a)
    if (a.outcome === 'timeout') throw new PaymentError('timeout', 'simulated timeout (attempt recorded)')
    return { provider_ref: a.ref, redirect_url: `https://sim.test/pay/${a.ref}`, status: 'pending' }
  }

  /**
   * Rebuild an attempt this process no longer remembers (the API restarted after the attempt row was
   * written). Only the ref the simulator itself issued is accepted, so a foreign ref is never adopted.
   */
  adopt(row: { id: string; order_id: string; provider_ref: string; amount_minor: number | string; currency: string; exponent: number }): boolean {
    const ref = row.provider_ref
    const known = this.byAttempt.get(row.id)
    if (known) return known.ref === ref
    if (!/^sim_inv_[0-9a-f]{8}_\d+$/.test(ref) || this.attempts.has(ref)) return false
    const a: SimAttempt = {
      input: {
        attempt_id: row.id, order_id: row.order_id, amount: { minor: Number(row.amount_minor), currency: row.currency, exponent: row.exponent },
        description: `LiwanOS order ${row.order_id}`, success_url: '', back_url: '', callback_url: '', expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
      ref, payment_id: ref.replace('sim_inv_', 'sim_pay_'), status: 'pending', outcome: this.defaultOutcome, refunded: 0,
    }
    this.attempts.set(ref, a); this.byAttempt.set(row.id, a)
    return true
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
      amount: o.amount ?? a.input.amount,
      // Like the provider, a refunded payment always states how much was refunded so far (the whole payment before any partial refund).
      ...(status === 'refunded' ? { refunded: { ...a.input.amount, minor: a.refunded > 0 ? a.refunded : a.input.amount.minor } } : {}), occurred_at: new Date(Date.UTC(2026, 0, 1, 0, 0, this.seq)).toISOString(),
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
      data: { id: a.payment_id, invoice_id: a.ref, status, amount: ev.amount.minor, currency: ev.amount.currency, ...(ev.refunded ? { refunded: ev.refunded.minor } : {}), metadata: { attempt_id: a.input.attempt_id } },
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
      provider: 'simulator', event_id: p.id, provider_ref: d.invoice_id ?? d.id, payment_id: d.id,
      attempt_id: d.invoice_id ? d.metadata?.attempt_id ?? null : parseAttemptDescription(d.description), merchant_account: p.account_name, live: p.live,
      status: d.status as ProviderEventStatus,
      amount: { currency: d.currency, exponent: 2, minor: d.amount },
      ...(Number.isInteger(d.refunded) ? { refunded: { currency: d.currency, exponent: 2, minor: d.refunded } } : {}), occurred_at: p.created_at, raw_type: p.type, simulated: true,
    }
  }

  async lookupAttempt(ref: string): Promise<ProviderEvent> {
    const a = this.need(ref) // like the real invoice endpoint, a token charge's payment id is unknown here
    return { ...this.eventFor(a, a.status), event_id: `sim_lookup_${a.ref}_${a.status}` }
  }
  async lookupPayment(paymentId: string): Promise<ProviderEvent> {
    return this.eventOfRecord(await this.readPayment(paymentId))
  }
  async readPayment(paymentId: string): Promise<PaymentRecord> {
    const record = this.payments.get(paymentId)
    if (!record) throw new PaymentError('not_found', paymentId)
    return { ...record }
  }
  private eventOfRecord(r: PaymentRecord): ProviderEvent {
    return {
      provider: 'simulator', event_id: `sim_lookup_${r.payment_id}_${r.status}`, provider_ref: r.payment_id, payment_id: r.payment_id,
      attempt_id: r.attempt_id, merchant_account: this.merchantAccount, live: false, status: r.status, amount: r.amount,
      ...(r.refunded ? { refunded: r.refunded } : {}), occurred_at: new Date(0).toISOString(), raw_type: `payment_${r.provider_status}`, simulated: true,
    }
  }
  async lookupByAttemptId(attemptId: string): Promise<ProviderEvent | null> {
    const a = this.byAttempt.get(attemptId)
    return a ? this.lookupAttempt(a.ref) : null
  }

  async cancelAttempt(providerRef: string): Promise<void> {
    this.need(providerRef).status = 'canceled'
  }

  async refund(paymentRef: string, amount?: Money): Promise<RefundOutcome> {
    const direct = this.payments.get(paymentRef)
    if (direct) return this.refundDirect(direct, amount)
    const a = [...this.attempts.values()].find(x => x.payment_id === paymentRef)
    if (!a) throw new PaymentError('not_found', paymentRef)
    if (a.status !== 'succeeded' && a.status !== 'refunded') throw new PaymentError('provider_error', 'payment not paid')
    const refunded = amount ?? { ...a.input.amount, minor: a.input.amount.minor - a.refunded }
    if (refunded.minor < MIN_REFUND_MINOR && refunded.minor > 0) return { outcome: 'below_minimum' }
    if (refunded.minor <= 0 || a.refunded + refunded.minor > a.input.amount.minor) throw new PaymentError('invalid_amount')
    // Like the provider, any refund makes the payment `refunded`; the cumulative figure says how much.
    a.refunded += refunded.minor
    a.status = 'refunded'
    return { outcome: 'refunded', payment_id: paymentRef, status: 'refunded', refunded: { ...a.input.amount, minor: a.refunded } }
  }

  /** The provider's rule, which the next step decides what to do with for hosted payments: one refund per payment, whole or partial, from 100 halalas. */
  private refundDirect(payment: PaymentRecord, amount?: Money): RefundOutcome {
    if (payment.status !== 'succeeded' && payment.status !== 'refunded') throw new PaymentError('provider_error', 'payment not paid')
    if (payment.refunded) return { outcome: 'already_refunded' }
    const minor = amount?.minor ?? payment.amount.minor
    if (minor < MIN_REFUND_MINOR) return { outcome: 'below_minimum' }
    if (minor > payment.amount.minor) throw new PaymentError('invalid_amount')
    payment.refunded = { ...payment.amount, minor }
    payment.status = 'refunded'
    payment.provider_status = 'refunded'
    return { outcome: 'refunded', payment_id: payment.payment_id, status: 'refunded', refunded: payment.refunded }
  }

  private newPayment(over: Pick<PaymentRecord, 'payment_id' | 'status' | 'amount' | 'description' | 'callback_url'> & Partial<PaymentRecord>): PaymentRecord {
    const record: PaymentRecord = {
      provider_status: PROVIDER_STATUS[over.status], refunded: null, attempt_id: parseAttemptDescription(over.description), live: false,
      invoice_id: null, token: null, authenticated: null, decline_message: null, ...over,
    }
    this.payments.set(record.payment_id, record)
    return record
  }

  async createIntent(i: CreateIntentInput): Promise<PaymentIntent> {
    const n = ++this.seq
    const intent: SimIntent = {
      id: `sim_intent_${this.instance}_${n}`, client_secret: `sim_secret_${this.instance}_${n}`, status: 'created',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), amount: i.amount, description: buildAttemptDescription(i.attempt_id), callback_url: i.callback_url, fulfilled: false,
    }
    this.intents.set(intent.id, intent)
    return this.publicIntent(intent)
  }
  private needIntent(id: string): SimIntent {
    const intent = this.intents.get(id)
    if (!intent) throw new PaymentError('not_found', id)
    return intent
  }
  private publicIntent({ fulfilled: _fulfilled, ...intent }: SimIntent): PaymentIntent { return { ...intent } }
  async getIntent(intentId: string): Promise<PaymentIntent> { return this.publicIntent(this.needIntent(intentId)) }
  async cancelIntent(intentId: string): Promise<IntentCancelOutcome> {
    const intent = this.needIntent(intentId)
    if (intent.status !== 'created') return 'not_cancelable'
    intent.status = 'canceled'
    return 'canceled'
  }

  /**
   * What the browser does with the publishable key: fulfils the intent. The amount, description and callback of the payment are the
   * intent's, whatever the browser asked for. A decline consumes the intent. A saved card yields a token (`active` after a paid
   * payment, `inactive` after a decline, `initiated` while the payer is still being authenticated).
   */
  fulfilIntent(intentId: string, input: FulfilIntentInput): PaymentRecord {
    const intent = this.needIntent(intentId)
    if (input.clientSecret !== intent.client_secret) throw new PaymentError('invalid_client_secret')
    if (intent.status !== 'created') throw new PaymentError('intent_not_fulfillable', intent.status)
    const card = input.card ?? { outcome: 'paid' }
    if (card.outcome === 'unknown') throw new PaymentError('timeout', 'simulated timeout')
    intent.status = 'fulfilled'
    const status: ProviderEventStatus = card.outcome === 'paid' ? 'succeeded' : card.outcome === 'declined' ? 'failed' : 'pending'
    const paymentId = `sim_pay_${this.instance}_${++this.seq}`
    let token: string | null = null
    if (input.saveCard) {
      token = `sim_token_${this.instance}_${this.seq}`
      this.addToken(token, status === 'succeeded' ? 'active' : status === 'failed' ? 'inactive' : 'initiated')
    }
    return { ...this.newPayment({ payment_id: paymentId, status, amount: intent.amount, description: intent.description, callback_url: intent.callback_url, token,
      decline_message: card.outcome === 'declined' ? card.message : null }) }
  }

  /**
   * A payment made straight with the publishable key, outside any intent: the browser chose the amount, the description and the callback
   * (the provider allows it, see the spike document), so a test can play every forgery a payer can attempt.
   */
  directPayment(over: Pick<PaymentRecord, 'status' | 'amount' | 'description' | 'callback_url'> & Partial<PaymentRecord>): PaymentRecord {
    return { ...this.newPayment({ payment_id: `sim_pay_${this.instance}_${++this.seq}`, ...over }) }
  }

  /** A webhook body for a direct payment, shaped like the provider's: no invoice, the locked description names the attempt. */
  paymentWebhookBody(paymentId: string, o: WebhookOverrides = {}): Uint8Array {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new PaymentError('not_found', paymentId)
    const status = o.status ?? payment.status
    return toBytes(JSON.stringify({
      id: o.eventId ?? `sim_evt_${paymentId}_${status}`, type: TYPE[status], created_at: new Date(0).toISOString(), secret_token: o.secret ?? this.webhookSecret,
      account_name: o.merchant ?? this.merchantAccount, live: o.live ?? false, simulated: true,
      data: { id: paymentId, status, amount: (o.amount ?? payment.amount).minor, currency: (o.amount ?? payment.amount).currency, description: payment.description,
        ...(payment.refunded ? { refunded: payment.refunded.minor } : {}), metadata: {} },
    }))
  }

  /** The body of the provider's registration event; `secret: null` leaves the shared secret out. */
  verificationWebhookBody(webhookId: string, code: string, o: SimVerificationOverrides = {}): Uint8Array {
    return toBytes(JSON.stringify({
      id: `sim_evt_verify_${webhookId}`, type: 'webhook_verification', created_at: new Date(0).toISOString(),
      ...(o.secret === null ? {} : { secret_token: o.secret ?? this.webhookSecret }), account_name: o.merchant ?? this.merchantAccount, live: o.live ?? false,
      data: { webhook_id: webhookId, verification_code: code },
    }))
  }
  webhookVerification(rawBody: Uint8Array, _h: AdapterHeaders = {}): WebhookVerification | null {
    let p: any
    try { p = JSON.parse(new TextDecoder().decode(rawBody)) } catch { return null }
    if (p?.type !== 'webhook_verification') return null
    const present = typeof p.secret_token === 'string' && p.secret_token.length > 0
    if (present && p.secret_token !== this.webhookSecret) throw new PaymentError('signature_invalid')
    if (!present && !this.registrationOpen) throw new PaymentError('signature_invalid')
    if (p.account_name !== undefined && p.account_name !== this.merchantAccount) throw new PaymentError('merchant_mismatch')
    if (p.live !== undefined && p.live !== false) throw new PaymentError('mode_mismatch')
    if (typeof p.data?.webhook_id !== 'string' || !/^\d{6}$/.test(String(p.data?.verification_code))) throw new PaymentError('invalid_event', 'bad verification event')
    return { webhook_id: p.data.webhook_id, code: p.data.verification_code, authenticated: present, occurred_at: p.created_at }
  }

  async chargeToken(i: ChargeTokenInput): Promise<ChargeTokenOutcome> {
    const prior = this.charges.get(i.given_id)
    if (prior) {
      if (prior.amount.minor !== i.amount.minor) throw new PaymentError('used_given_id')
      return prior.outcome
    }
    const token = this.tokens.get(i.token)
    const script = this.tokenCharges.get(i.token) ?? { outcome: 'paid' as const }
    if (script.outcome === 'unknown') return { outcome: 'unknown', reason: 'timeout' }
    if (script.outcome === 'token_unusable' || !token || token.status === 'initiated' || token.status === 'inactive') return { outcome: 'token_unusable' }
    // Like the provider, the payment's id is the caller's `given_id`.
    const paymentId = i.given_id
    if (script.outcome === 'used_given_id') {
      // A lost answer followed by a retry: the first charge exists at the provider, the second call is refused.
      if (script.thenPaid !== false) this.newPayment({ payment_id: paymentId, status: 'succeeded', amount: i.amount, description: i.description, callback_url: i.callback_url })
      throw new PaymentError('used_given_id', undefined, 400)
    }
    const outcome = token.status === 'save_only' || script.outcome === 'needs_customer_action'
      ? { outcome: 'needs_customer_action' as const, payment: this.newPayment({ payment_id: paymentId, status: 'pending', amount: i.amount, description: i.description, callback_url: i.callback_url }) }
      : script.outcome === 'declined'
        ? { outcome: 'declined' as const, message: script.message, payment: this.newPayment({ payment_id: paymentId, status: 'failed', amount: i.amount, description: i.description, callback_url: i.callback_url, decline_message: script.message }) }
        : { outcome: 'paid' as const, payment: this.newPayment({ payment_id: paymentId, status: 'succeeded', amount: i.amount, description: i.description, callback_url: i.callback_url }) }
    this.charges.set(i.given_id, { amount: i.amount, outcome })
    return outcome
  }

  async getToken(id: string): Promise<TokenInfo> {
    const t = this.tokens.get(id)
    if (!t) throw new PaymentError('not_found', 'token')
    return { id, status: t.status, active: t.status === 'active', brand: t.brand, last_four: t.last_four, exp_month: t.exp_month, exp_year: t.exp_year, funding: t.funding }
  }

  async deleteToken(id: string): Promise<void> { this.tokens.delete(id) }
}
