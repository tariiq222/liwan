import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { client, money, monthly, setup, url } from '../__tests__/commercial-helpers.js'
import { SignupService } from './service.js'

describe.skipIf(!url)('public signup on scratch PostgreSQL', () => {
  const pool = new Pool({ connectionString: url })
  let planId: string
  let testNumber = 0
  beforeAll(async () => {
    const { version } = await setup(pool)
    const api = client(pool)
    expect((await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Signup regression' })).status).toBe(201)
    const draft = await api('POST', '/plans', {
      name: `Trial ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {},
      included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 0,
      extra_branch_prices: [], extra_branches_limit: 0, included_users: 3, included_storage_mb: 0,
      storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 14, grace_days: 0,
      auto_suspend: true, auto_renew_allowed: false,
    })
    expect(draft.status).toBe(201)
    const path = `/plans/${draft.body.id}`
    const validated = await api('POST', `${path}/validate`, { edit_revision: 1, reason: 'Signup regression' })
    const plan = await api('POST', `${path}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Signup regression' })
    expect(plan.status).toBe(200)
    planId = plan.body.id
  })
  afterAll(async () => { await pool.end() })

  function fixture() {
    const n = ++testNumber
    const ip = `192.0.2.${n}`
    const input = { company_name: 'Signup company', admin_name: 'Administrator',
      email: `trial-${randomUUID()}@example.test`, mobile: `+966555000${String(n).padStart(3, '0')}` }
    let now = new Date()
    let sms = '', email = ''
    const service = new SignupService(pool, {
      planId, secret: 'a'.repeat(32), dailyLimit: 100, now: () => now,
      sms: async (_mobile, code) => { sms = code },
      email: async (_address, code) => { email = code },
    })
    const start = () => service.start(input, ip)
    const reachEmail = async () => {
      const { signup_id } = await start()
      await service.verifySms(signup_id, sms)
      await service.sendEmail(signup_id, ip)
      return signup_id
    }
    return { input, ip, service, start, reachEmail, sms: () => sms, email: () => email,
      advance: (minutes: number) => { now = new Date(now.getTime() + minutes * 60_000) } }
  }

  it('requires both proofs and completes concurrent email verification with one zero-due order', async () => {
    const f = fixture()
    const { signup_id } = await f.start()
    await expect(f.service.sendEmail(signup_id, f.ip)).rejects.toMatchObject({ code: 'invalid_code' })
    await f.service.verifySms(signup_id, f.sms())
    await f.service.sendEmail(signup_id, f.ip)
    expect((await pool.query('SELECT id FROM customers WHERE admin_login=$1', [f.input.email])).rowCount).toBe(0)
    await expect(Promise.all([1, 2].map(() => f.service.verifyEmail(signup_id, f.email()))))
      .resolves.toEqual([{ ok: true }, { ok: true }])
    const wrong = f.email() === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      await expect(f.service.verifyEmail(signup_id, wrong)).rejects.toMatchObject({ code: 'invalid_code' })
    }
    await expect(f.service.verifyEmail(signup_id, f.email())).resolves.toEqual({ ok: true })
    const result = await pool.query(`SELECT o.payment_state,o.fulfillment_state,o.due_now_minor,s.state,
      s.trial_ends_at > now()+interval '13 days' AS has_trial, c.tenant_id,
      (SELECT count(*)::int FROM commercial_outbox WHERE aggregate_id=o.id::text AND kind='fulfillment.enqueue') AS jobs
      FROM customers c JOIN subscriptions s ON s.customer_id=c.id JOIN orders o ON o.customer_id=c.id WHERE c.admin_login=$1`, [f.input.email])
    expect(result.rows).toEqual([{ payment_state: 'not_required', fulfillment_state: 'queued', due_now_minor: '0',
      state: 'trialing', has_trial: true, tenant_id: null, jobs: 1 }])
  })

  it('rejects multiline company names before sending', async () => {
    const f = fixture()
    f.input.company_name = 'Acme\nHeadquarters'
    await expect(f.start()).rejects.toMatchObject({ name: 'ZodError' })
    expect(f.sms()).toBe('')
  })

  it('refuses a duplicate verified mobile even with another verified email', async () => {
    const f = fixture()
    const first = await f.reachEmail()
    await f.service.verifyEmail(first, f.email())
    f.advance(2)
    f.input.email = `other-${f.input.email}`
    const second = await f.reachEmail()
    await expect(f.service.verifyEmail(second, f.email())).rejects.toMatchObject({ code: 'trial_already_used' })
    expect((await pool.query('SELECT id FROM customers WHERE admin_login=$1', [f.input.email])).rowCount).toBe(0)
  })

  it('commits wrong attempts and refuses a sixth try even with the correct code', async () => {
    const f = fixture()
    const { signup_id } = await f.start()
    const wrong = f.sms() === '000000' ? '111111' : '000000'
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(f.service.verifySms(signup_id, wrong)).rejects.toMatchObject({ code: 'invalid_code' })
    }
    await expect(f.service.verifySms(signup_id, f.sms())).rejects.toMatchObject({ code: 'invalid_code' })
  })

  it('enforces the durable source limit across IPv6 addresses in one subnet', async () => {
    const f = fixture()
    for (let i = 1; i <= 10; i++) {
      const mobile = `+966555001${String(i).padStart(3, '0')}`
      await f.service.start({ ...f.input, mobile }, `2001:db8:1:2::${i}`)
    }
    await expect(f.service.start(f.input, '2001:db8:1:2::f')).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(f.service.start(f.input, '2001:db8:1:3::1')).resolves.toHaveProperty('signup_id')
  })

  it('reserves delivery budget even when the SMS sender is unavailable', async () => {
    const f = fixture()
    const service = new SignupService(pool, {
      planId, secret: 'a'.repeat(32), dailyLimit: 100,
      sms: async () => { throw new Error('synthetic transport failure') },
      email: async () => {},
    })
    await expect(service.start(f.input, f.ip)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(service.start(f.input, f.ip)).rejects.toMatchObject({ code: 'rate_limited' })
    expect((await pool.query('SELECT id FROM customers WHERE admin_login=$1', [f.input.email])).rowCount).toBe(0)
  })

  it('serializes concurrent issuance and expires codes', async () => {
    const f = fixture()
    const issued = await Promise.allSettled([f.start(), f.start()])
    expect(issued.filter(x => x.status === 'rejected')).toEqual([{
      status: 'rejected', reason: expect.objectContaining({ code: 'rate_limited' }),
    }])
    const successful = issued.find(x => x.status === 'fulfilled')!
    f.advance(6)
    await expect(f.service.verifySms(successful.value.signup_id, f.sms())).rejects.toMatchObject({ code: 'invalid_code' })
  })
})
