import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { handleProviderEvent } from '../commercial/payments.js'
import { UNSIGNED_PER_HOUR, WEBHOOK_VERIFICATION_ACTION } from '../commercial/payment-webhook-verification.js'
import { sendVendorAlerts, VENDOR_ALERT_KIND } from '../commercial/vendor-alerts.js'

const suite = url ? describe : describe.skip
suite('the provider webhook registration code reaches the operator', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const adapter = new SimulatorAdapter()
  const open = new SimulatorAdapter({ webhookRegistrationOpen: true })
  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { await pool.query("DELETE FROM audit_events WHERE action=$1", [WEBHOOK_VERIFICATION_ACTION]); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })
  const deliver = (body: Uint8Array, using: SimulatorAdapter = adapter) => handleProviderEvent(pool, { provider: 'simulator', adapter: using, rawBody: body, headers: {} })
  const rows = async () => (await pool.query('SELECT * FROM audit_events WHERE action=$1 ORDER BY created_at', [WEBHOOK_VERIFICATION_ACTION])).rows

  it('answers success, is not a payment event, and records the code once for the operator', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const before = (await pool.query('SELECT (SELECT count(*)::int FROM payment_events) AS events,(SELECT count(*)::int FROM payment_attempts) AS attempts')).rows[0]
      expect(await deliver(adapter.verificationWebhookBody('wh_1', '123456'))).toEqual({ status: 200, outcome: 'verification' })
      expect(await deliver(adapter.verificationWebhookBody('wh_1', '123456'))).toEqual({ status: 200, outcome: 'verification' })
      expect(await rows()).toHaveLength(1)
      expect((await rows())[0]).toMatchObject({ actor: 'system', subject: 'wh_1', metadata: { code: '123456', authenticated: true } })
      expect((await pool.query('SELECT (SELECT count(*)::int FROM payment_events) AS events,(SELECT count(*)::int FROM payment_attempts) AS attempts')).rows[0]).toEqual(before)
      expect(log.mock.calls.map(c => String(c[0])).filter(m => m.includes('payment_webhook_verification')).join('\n')).toContain('123456')
    } finally { log.mockRestore() }
  })

  it('still refuses a registration event with a wrong secret, merchant or mode, and records nothing', async () => {
    for (const bad of [{ secret: 'wrong' }, { merchant: 'other' }, { live: true }])
      expect(await deliver(adapter.verificationWebhookBody('wh_2', '654321', bad))).toEqual({ status: 401, outcome: 'rejected' })
    expect(await deliver(new TextEncoder().encode(JSON.stringify({ type: 'webhook_verification', secret_token: adapter.webhookSecret, data: { webhook_id: 'x', verification_code: 'nope' } })))).toEqual({ status: 401, outcome: 'rejected' })
    expect(await rows()).toHaveLength(0)
  })

  it('refuses an event without the secret while registration is closed, and records nothing', async () => {
    expect(await deliver(adapter.verificationWebhookBody('wh_closed', '111111', { secret: null }))).toEqual({ status: 401, outcome: 'rejected' })
    expect(await deliver(adapter.verificationWebhookBody('wh_closed', '111111', { secret: null, merchant: undefined }), adapter)).toEqual({ status: 401, outcome: 'rejected' })
    expect(await rows()).toHaveLength(0)
  })

  it('while registration is open, records an event without the secret once, with the webhook id, and refuses a wrong account or mode', async () => {
    expect(await deliver(open.verificationWebhookBody('wh_open', '222222', { secret: null }), open)).toEqual({ status: 200, outcome: 'verification' })
    expect(await deliver(open.verificationWebhookBody('wh_open', '222222', { secret: null }), open)).toEqual({ status: 200, outcome: 'verification' })
    expect(await rows()).toHaveLength(1)
    expect((await rows())[0]).toMatchObject({ subject: 'wh_open', metadata: { webhook_id: 'wh_open', code: '222222', authenticated: false } })
    expect(await deliver(open.verificationWebhookBody('wh_x', '333333', { secret: null, merchant: 'other' }), open)).toEqual({ status: 401, outcome: 'rejected' })
    expect(await deliver(open.verificationWebhookBody('wh_x', '333333', { secret: null, live: true }), open)).toEqual({ status: 401, outcome: 'rejected' })
    expect(await rows()).toHaveLength(1)
  })

  it('a signed event ignores the registration setting, closed or open, and is never held by the unsigned bound', async () => {
    expect(await deliver(adapter.verificationWebhookBody('wh_signed', '444444'), adapter)).toEqual({ status: 200, outcome: 'verification' })
    expect(await deliver(open.verificationWebhookBody('wh_signed2', '555555'), open)).toEqual({ status: 200, outcome: 'verification' })
    for (let i = 0; i < UNSIGNED_PER_HOUR; i++) await deliver(open.verificationWebhookBody(`wh_u${i}`, String(100000 + i), { secret: null }), open)
    expect(await deliver(open.verificationWebhookBody('wh_signed3', '666666'), open)).toEqual({ status: 200, outcome: 'verification' })
    expect((await rows()).filter(r => r.metadata.authenticated === true)).toHaveLength(3)
  })

  it('answers 429 over the unsigned bound and records nothing more, even under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: UNSIGNED_PER_HOUR * 2 }, (_, i) => deliver(open.verificationWebhookBody(`wh_c${i}`, String(200000 + i), { secret: null }), open)))
    expect(results.filter(r => r.status === 200)).toHaveLength(UNSIGNED_PER_HOUR)
    expect(results.filter(r => r.status === 429 && r.outcome === 'throttled')).toHaveLength(UNSIGNED_PER_HOUR)
    expect(await rows()).toHaveLength(UNSIGNED_PER_HOUR)
    // A duplicate of a recorded event is still a no-op success at the bound; a new one is refused.
    expect((await deliver(open.verificationWebhookBody('wh_c0', '200000', { secret: null }), open)).status).toBe(200)
    expect((await deliver(open.verificationWebhookBody('wh_new', '999999', { secret: null }), open)).status).toBe(429)
    expect(await rows()).toHaveLength(UNSIGNED_PER_HOUR)
  })

  it('reaches the operator through the vendor alert scan, with no customer in it, and never again once sent', async () => {
    await deliver(adapter.verificationWebhookBody('wh_alert', '246810'))
    await deliver(open.verificationWebhookBody('wh_open', '135790', { secret: null }), open)
    const mails: { subject: string; text: string }[] = []
    const mail = { send: async (m: { subject: string; text: string }) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } }
    const run = () => sendVendorAlerts(pool, { now: new Date(), env: { LIWAN_VENDOR_ALERT_EMAIL_TO: 'owner@example.test' }, mail, consoleOrigin: 'https://admin.example.test', log: () => {} } as never)
    await run()
    expect(mails.filter(m => m.text.includes('246810') || m.text.includes('135790'))).toHaveLength(2)
    const authenticated = mails.find(m => m.text.includes('246810'))!
    expect(authenticated.subject).toContain('[يتطلب إجراء]')
    expect(authenticated.text).not.toContain('العميل:')
    expect(authenticated.text).not.toContain('بلا الرمز السري')
    expect(authenticated.text).toContain('wh_alert')
    expect(authenticated.text).toContain('أدخل الرمز فقط إذا كان معرّف الـwebhook')
    expect(mails.find(m => m.text.includes('135790'))!.text).toContain('بلا الرمز السري')
    const sent = mails.length
    await run()
    expect(mails).toHaveLength(sent)
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind=$1 AND payload->>'event'='webhook_verification'", [VENDOR_ALERT_KIND])).rows[0].n).toBe(2)
  })
})
