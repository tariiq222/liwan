import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formPaymentSessionSchema, orderKindSchema, paymentAttemptRequestSchema } from '@liwan/commercial-contracts'
import {
  autoRenewBody, CARD_CONSENT_KEY, CARD_CONSENT_TEXT_VERSION, clearPaymentStarted, DEAD_INTENT_FAILURES, markPaymentStarted, moyasarFormConfig,
  paymentAttemptBody, payPath, payRefusal, paymentWasStarted, scopedFormCss, sessionMsLeft, STAND_IN_PUBLISHABLE_KEY,
} from '../cardPayment'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const locale = (lang: string) => JSON.parse(read(`i18n/locales/${lang}/subscription.json`)).subscription
const session = formPaymentSessionSchema.parse({
  attempt_id: 'a-1', intent: { id: 'intent-1', client_secret: 'secret-1' }, publishable_key: 'pk_test_abc',
  amount: { minor: 12_500, currency: 'SAR', exponent: 2 }, expires_at: '2026-11-14T10:00:00.000Z',
})

describe('the consent wording and its version', () => {
  // Each wording that was ever shown to a customer is recorded against its version. Editing the text without a new version, or a
  // new version without a recorded wording, fails here: the consent a customer gave must name the text they saw.
  const WORDINGS: Record<string, string> = {
    '2026-11-14': '5047286849e23091240618418cf4819ae5b457770e51622476327c7d803c785a',
  }
  it('has a recorded fingerprint for the current version that matches both locale texts', () => {
    expect(CARD_CONSENT_KEY).toBe('subscription.cardConsent.text')
    const text = `${locale('ar').cardConsent.text}\n${locale('en').cardConsent.text}`
    expect(WORDINGS[CARD_CONSENT_TEXT_VERSION], 'record the wording of this version').toBeDefined()
    expect(createHash('sha256').update(text).digest('hex'), 'the wording changed: bump CARD_CONSENT_TEXT_VERSION and record the new fingerprint').toBe(WORDINGS[CARD_CONSENT_TEXT_VERSION])
  })
  it('is the one text beside the pay page checkbox and the auto-renew switch', () => {
    expect(read('app/components/subscription/AutoRenewControl.vue')).toContain('t(CARD_CONSENT_KEY)')
    expect(read('app/pages/subscription/pay/[order].vue')).toContain('t(CARD_CONSENT_KEY)')
    expect(locale('en').autoRenew.consent).toBeUndefined()
  })
})

describe('what the browser sends to our server', () => {
  it('a payment attempt carries only the documented keys, and the version only with a saved card', () => {
    expect(paymentAttemptBody(false)).toEqual({ method: 'form', save_card: false })
    expect(paymentAttemptBody(true)).toEqual({ method: 'form', save_card: true, consent_text_version: CARD_CONSENT_TEXT_VERSION })
    // The contract's strict schema accepts exactly these bodies and no other key.
    for (const saving of [true, false]) expect(paymentAttemptRequestSchema.parse(paymentAttemptBody(saving))).toEqual(paymentAttemptBody(saving))
    for (const saving of [true, false]) expect(Object.keys(paymentAttemptBody(saving)).sort()).toEqual(saving ? ['consent_text_version', 'method', 'save_card'] : ['method', 'save_card'])
  })
  it('the auto-renew switch carries the version only when turning on', () => {
    expect(autoRenewBody(true)).toEqual({ enabled: true, consent_text_version: CARD_CONSENT_TEXT_VERSION })
    expect(autoRenewBody(false)).toEqual({ enabled: false })
  })
  it('the composable posts those bodies and nothing built from the page: no key, no idempotency key, no card field', () => {
    const source = read('app/composables/useSubscription.ts')
    expect(source).toContain('paymentAttemptRequestSchema.parse(paymentAttemptBody(saveCard))')
    expect(source).toContain('body: autoRenewBody(enabled)')
    expect(source).not.toMatch(/idempotency_key: idempotencyKey\(store\(\), `\$\{action\}:pay`\)/)
    // No page or component reads a field of the provider's form.
    for (const file of ['app/pages/subscription/pay/[order].vue', 'app/components/subscription/PaymentForm.vue']) {
      expect(read(file), file).not.toMatch(/\.value\.(number|cvc|csc)|querySelector|addEventListener\('input'|console\./)
    }
  })
})

describe('the provider form options', () => {
  const config = moyasarFormConfig(session, { element: {} as HTMLElement, saveCard: true, locale: 'ar', origin: 'https://acme.example', description: 'x', onFailure: () => {} })
  it('uses the intent, the publishable key and the cards we accept, from the session only', () => {
    expect(config.use_payment_intent).toBe(true)
    expect(config.payment_intent).toEqual({ id: 'intent-1', client_secret: 'secret-1' })
    expect(config.publishable_api_key).toBe('pk_test_abc')
    expect(config.methods).toEqual(['creditcard'])
    expect(config.supported_networks).toEqual(['mada', 'visa', 'mastercard'])
    expect(config.credit_card).toEqual({ save_card: true })
    expect(config.language).toBe('ar')
    expect(config.amount).toBe(12_500)
    expect(config.currency).toBe('SAR')
  })
  it('follows the customer choice and the interface language', () => {
    const en = moyasarFormConfig(session, { element: {} as HTMLElement, saveCard: false, locale: 'en', origin: 'https://acme.example', description: 'x', onFailure: () => {} })
    expect(en.credit_card).toEqual({ save_card: false })
    expect(en.language).toBe('en')
  })
  it('never weakens authentication and passes no metadata, no id and no other payment fields', () => {
    expect(JSON.stringify(config)).not.toMatch(/3ds|metadata|given_id|manual|apple|samsung|google|stc/i)
    expect(Object.keys(config).sort()).toEqual(['amount', 'callback_url', 'credit_card', 'currency', 'description', 'element', 'language', 'methods', 'on_failure', 'payment_intent', 'publishable_api_key', 'supported_networks', 'use_payment_intent'])
  })
  it('sends an immediate provider answer to the relay for this attempt, never to a stored return address', () => {
    expect(config.callback_url).toBe('https://acme.example/api/commercial/payment-callback?attempt=a-1')
  })
})

describe('the provider package stylesheet', () => {
  const css = readFileSync(resolve(root, '../../node_modules/moyasar-payment-form/dist/moyasar.css'), 'utf8')
  it('is scoped to the form: no rule outside its own element survives', () => {
    const scoped = scopedFormCss(css)
    const noComments = scoped.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(noComments).not.toMatch(/(^|\})\s*(html|body)\s*[,{]/)
    expect(noComments).toContain('div#mysr :host{')
    expect(noComments.length).toBeGreaterThan(css.length / 2)
    // Every top-level rule that is not an at-rule names the form's element.
    let depth = 0; let selector = ''; const outside: string[] = []
    for (const ch of noComments) {
      if (ch === '{') { depth++; if (depth === 1 && !selector.trim().startsWith('@') && !selector.includes('#mysr')) outside.push(selector.trim()); if (depth === 1) selector = '' } else if (ch === '}') { depth--; selector = '' } else if (depth === 0) selector += ch
    }
    expect(outside).toEqual([])
  })
})

describe('refusals and the session clock', () => {
  const refusal = (code: string, statusCode = 409) => ({ statusCode, data: { code } })
  it('maps every documented refusal, and treats an unknown one as a plain failure', () => {
    expect(payRefusal(refusal('payment_in_progress'))).toBe('in_progress')
    expect(payRefusal(refusal('payment_not_awaiting'))).toBe('not_awaiting')
    expect(payRefusal(refusal('card_form_unavailable'))).toBe('form_unavailable')
    expect(payRefusal(refusal('auto_renew_not_allowed'))).toBe('auto_renew_not_allowed')
    expect(payRefusal({ statusCode: 403, data: {} })).toBe('forbidden')
    expect(payRefusal({ statusCode: 404, data: {} })).toBe('not_found')
    expect(payRefusal(refusal('consent_required', 422))).toBe('failed')
    expect(payRefusal(new Error('network'))).toBe('failed')
  })
  it('reads the nested body the client error carries', () => {
    expect(payRefusal({ statusCode: 409, data: { data: { code: 'payment_in_progress' } } })).toBe('in_progress')
  })
  it('counts a session as expired a little before its stated end', () => {
    const at = Date.parse(session.expires_at)
    expect(sessionMsLeft(session, at - 60_000)).toBeGreaterThan(0)
    expect(sessionMsLeft(session, at - 4_000)).toBeLessThan(0)
    expect(DEAD_INTENT_FAILURES.has('intent_not_fulfillable')).toBe(true)
  })
  it('the page offers a stand-in only for the key the test stack serves', () => {
    expect(STAND_IN_PUBLISHABLE_KEY).toBe('pk_stand_in')
    expect(readFileSync(resolve(root, 'e2e/commercial-fixtures.json'), 'utf8')).toContain(STAND_IN_PUBLISHABLE_KEY)
  })
})

describe('the tab marker that an order was opened for card payment', () => {
  it('is set, read and cleared per order', () => {
    const data = new Map<string, string>()
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
    expect(paymentWasStarted(store, 'o-1')).toBe(false)
    markPaymentStarted(store, 'o-1')
    expect(paymentWasStarted(store, 'o-1')).toBe(true)
    expect(paymentWasStarted(store, 'o-2')).toBe(false)
    clearPaymentStarted(store, 'o-1')
    expect(paymentWasStarted(store, 'o-1')).toBe(false)
    expect(paymentWasStarted(null, 'o-1')).toBe(false)
  })
  it('the pay path encodes the order id', () => { expect(payPath('a b')).toBe('/subscription/pay/a%20b') })
})

describe('the pay page strings', () => {
  const keys = (file: string) => [...new Set([...read(file).matchAll(/'(subscription\.[\w.]+)'/g)].map(match => match[1]!))].filter(key => !/^subscription\.(read|manage)$/.test(key))
  const flat = (value: unknown, prefix = ''): string[] => Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => (child && typeof child === 'object' ? flat(child, `${prefix}${key}.`) : [`${prefix}${key}`]))
  const available = (lang: string) => new Set(flat(locale(lang)).map(key => `subscription.${key}`))
  for (const file of ['app/pages/subscription/pay/[order].vue', 'app/components/subscription/PaymentForm.vue', 'app/components/subscription/PaymentMethodPanel.vue', 'app/pages/subscription/status.vue']) {
    it(`${file} resolves every literal key in both languages`, () => {
      for (const lang of ['ar', 'en']) expect(keys(file).filter(key => !available(lang).has(key) && !key.endsWith('.')), `${lang} ${file}`).toEqual([])
    })
  }
  it('names every kind of order in both languages', () => {
    for (const lang of ['ar', 'en']) for (const kind of orderKindSchema.options) expect(locale(lang).pay.kinds[kind], `${lang} ${kind}`).toBeTruthy()
  })
})
