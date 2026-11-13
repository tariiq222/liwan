import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { handleProviderEvent } from '../commercial/payments.js'
import { UNAUTHENTICATED_PER_HOUR, WEBHOOK_VERIFICATION_ACTION } from '../commercial/payment-webhook-verification.js'
import { sendVendorAlerts, VENDOR_ALERT_KIND } from '../commercial/vendor-alerts.js'

const suite = url ? describe : describe.skip
suite('the provider webhook registration code reaches the operator', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const adapter = new SimulatorAdapter()
  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { await pool.query("DELETE FROM audit_events WHERE action=$1", [WEBHOOK_VERIFICATION_ACTION]); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })
  const deliver = (body: Uint8Array) => handleProviderEvent(pool, { provider: 'simulator', adapter, rawBody: body, headers: {} })
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

  it('bounds the codes of events that carry no secret, and marks them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (let i = 0; i < UNAUTHENTICATED_PER_HOUR + 2; i++)
        expect((await deliver(adapter.verificationWebhookBody(`wh_${i}`, String(100000 + i), { secret: null }))).status).toBe(200)
      const recorded = await rows()
      expect(recorded).toHaveLength(UNAUTHENTICATED_PER_HOUR)
      expect(recorded.every(r => r.metadata.authenticated === false)).toBe(true)
      // An event that carries the secret is never held back by that bound.
      await deliver(adapter.verificationWebhookBody('wh_real', '999999'))
      expect(await rows()).toHaveLength(UNAUTHENTICATED_PER_HOUR + 1)
    } finally { log.mockRestore() }
  })

  it('reaches the operator through the vendor alert scan, with no customer in it, and never again once sent', async () => {
    await deliver(adapter.verificationWebhookBody('wh_alert', '246810'))
    await deliver(adapter.verificationWebhookBody('wh_open', '135790', { secret: null }))
    const mails: { subject: string; text: string }[] = []
    const mail = { send: async (m: { subject: string; text: string }) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } }
    const run = () => sendVendorAlerts(pool, { now: new Date(), env: { LIWAN_VENDOR_ALERT_EMAIL_TO: 'owner@example.test' }, mail, consoleOrigin: 'https://admin.example.test', log: () => {} } as never)
    await run()
    expect(mails.filter(m => m.text.includes('246810') || m.text.includes('135790'))).toHaveLength(2)
    const authenticated = mails.find(m => m.text.includes('246810'))!
    expect(authenticated.subject).toContain('[يتطلب إجراء]')
    expect(authenticated.text).not.toContain('العميل:')
    expect(authenticated.text).not.toContain('لم يحمل الرمز السري')
    expect(mails.find(m => m.text.includes('135790'))!.text).toContain('لم يحمل الرمز السري')
    const sent = mails.length
    await run()
    expect(mails).toHaveLength(sent)
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind=$1 AND payload->>'event'='webhook_verification'", [VENDOR_ALERT_KIND])).rows[0].n).toBe(2)
  })
})
