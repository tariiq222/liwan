import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { attention } from '../commercial/attention.js'
import { claimForSend, reconcileTokenCharges } from '../commercial/token-charge.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { generateRenewals } from '../commercial/renewals.js'
import { sendRenewalNotices } from '../commercial/renewal-notices.js'
import type { MailMessage } from '../commercial/mail-adapter.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { client, money, monthly, setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
const renewalDate = '2026-12-10'
const price = 11_500
const day10 = Date.parse('2026-11-29T21:00:00Z')
const day7End = Date.parse('2026-12-03T20:59:59Z')

suite('stored-method renewal notice and collection gate', () => {
  const pool = new Pool({ connectionString: url })
  const api = client(pool)
  let paidPlan: string, freePlan: string, disabledPlan: string
  const returnOrigin = fixedReturnOrigin('https://liwan.test')

  async function plan(basePrice: number, autoRenew: boolean) {
    const created = await api('POST', '/plans', {
      name: `Renewal notice ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(basePrice) }], platform_limits: {}, included_bundle_revision_ids: [],
      optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: 0,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400,
      storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001',
      trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: autoRenew,
    })
    expect(created.status).toBe(201)
    const checked = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 1, reason: 'Notice fixture' })
    expect(checked).toMatchObject({ status: 200 })
    const published = await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: checked.body.edit_revision, reason: 'Notice fixture' })
    expect(published.status).toBe(200)
    return published.body.id as string
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Notice fixture' })
    paidPlan = await plan(10_000, true)
    freePlan = await plan(0, true)
    disabledPlan = await plan(10_000, false)
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE') })
  afterAll(async () => { await pool.end() })

  async function fixture(planId = paidPlan) {
    const customer = randomUUID(), method = randomUUID(), login = `fixture-${customer}@example.test`
    await pool.query("INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,'Renewal fixture','Manager',$2)", [customer,login])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: {
      kind: 'new', plan_revision_id: planId, bundle_revision_ids: [], cadence: monthly,
      requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0,
    } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() },
      { kind: 'vendor', actor_id: 'fixture', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] })
    await pool.query("UPDATE orders SET payment_state=CASE WHEN payment_state='awaiting_payment' THEN 'paid' ELSE payment_state END,fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    const subscription = order.subscription_id
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at=$2,revision=revision+1 WHERE id=$1", [subscription,renewalDate])
    await pool.query(`INSERT INTO payment_methods(id,subscription_id,provider,state,token_ciphertext,key_id,consent_at,consent_actor,consent_version)
      VALUES($1,$2,'simulator','active',$3,'fixture-key','2026-11-01T00:00:00Z','fixture','fixture')`, [method,subscription,Buffer.from([1])])
    const adapter = new SimulatorAdapter()
    const run = () => generateRenewals(pool, { subscription_id: subscription, now: new Date(`${renewalDate}T08:00:00Z`), adapter, returnOrigin })
    const notices = async () => (await pool.query(`SELECT id,state,sent_at,void_reason,amount_minor,currency,exponent,method_id,renewal_date::text,cadence_unit,cadence_count
      FROM renewal_notices WHERE subscription_id=$1 ORDER BY id`, [subscription])).rows
    const attempts = async () => (await pool.query(`SELECT a.id,a.status,a.token_charge,a.notice_id,i.total_minor
      FROM orders o JOIN invoices i ON i.order_id=o.id JOIN payment_attempts a ON a.invoice_id=i.id
      WHERE o.subscription_id=$1 AND o.kind='renewal'`, [subscription])).rows
    return { subscription, method, login, adapter, run, notices, attempts }
  }

  async function seed(f: Awaited<ReturnType<typeof fixture>>, values: {
    method?: string; date?: string; minor?: number; currency?: string; exponent?: number; cadenceCount?: number; sentAt?: Date | null
  } = {}) {
    const id = randomUUID()
    const sentAt = values.sentAt === undefined ? new Date(day10) : values.sentAt
    await pool.query(`INSERT INTO renewal_notices(id,subscription_id,method_id,renewal_date,amount_minor,currency,exponent,state,sent_at,cadence_unit,cadence_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'month',$10)`, [id,f.subscription,values.method ?? f.method,values.date ?? renewalDate,
      values.minor ?? price,values.currency ?? 'SAR',values.exponent ?? 2,sentAt ? 'sent' : 'due',sentAt,values.cadenceCount ?? 1])
    return id
  }

  it('begins on the Riyadh D-10 boundary, uses invoice money and leases before mailing', async () => {
    const f = await fixture()
    let now = day10 - 1
    const send = vi.fn(async (_message: MailMessage) => ({ accepted: true, provider_message_id: 'fixture' }))
    const job = () => sendRenewalNotices(pool, { adapter: f.adapter, mail: { send }, clock: () => now })
    await job()
    expect(await f.notices()).toEqual([])
    now = day10
    await Promise.all([job(),job()])
    expect(send.mock.calls.filter(([message]) => message.to === f.login)).toHaveLength(1)
    expect(await f.notices()).toMatchObject([{ state: 'sent', sent_at: new Date(day10), amount_minor: String(price),
      currency: 'SAR', exponent: 2, method_id: f.method, renewal_date: renewalDate, cadence_unit: 'month', cadence_count: 1 }])
    const charge = vi.spyOn(f.adapter, 'chargeToken')
    await f.run()
    expect(await f.attempts()).toMatchObject([{ status: 'created', token_charge: true, notice_id: (await f.notices())[0].id, total_minor: String(price) }])
    expect(charge).not.toHaveBeenCalled()
    expect((await f.run())).toHaveLength(0)
  })

  it.each(['rejected', 'throws', 'accepted_late'] as const)('does not mark a %s email as timely delivery', async outcome => {
    const f = await fixture()
    let now = day7End
    const send = vi.fn(async () => {
      if (outcome === 'throws') throw new Error('simulated rejection')
      if (outcome === 'accepted_late') now += 1_000
      return { accepted: outcome === 'accepted_late', provider_message_id: 'fixture' }
    })
    await sendRenewalNotices(pool, { adapter: f.adapter, mail: { send }, clock: () => now })
    expect(await f.notices()).toMatchObject([{ state: outcome === 'accepted_late' ? 'void' : 'due', sent_at: null }])
    await f.run()
    expect(await f.attempts()).toMatchObject([{ token_charge: false, status: 'redirected', notice_id: null }])
  })

  it('retries mail after one hour without issuing a receipt on the first refusal', async () => {
    const f = await fixture()
    let now = day10
    const send = vi.fn()
      .mockResolvedValueOnce({ accepted: false, provider_message_id: 'fixture' })
      .mockResolvedValueOnce({ accepted: true, provider_message_id: 'fixture' })
    const job = () => sendRenewalNotices(pool, { adapter: f.adapter, mail: { send }, clock: () => now })
    await job()
    expect(await f.notices()).toMatchObject([{ state: 'due', sent_at: null }])
    now += 60 * 60_000 - 1
    await job()
    expect(send).toHaveBeenCalledTimes(1)
    now += 1
    await job()
    expect(send).toHaveBeenCalledTimes(2)
    expect(await f.notices()).toMatchObject([{ state: 'sent', sent_at: new Date(now) }])
  })

  it.each(['test', 'live'] as const)('leaves %s mode on hosted checkout even with notice evidence', async mode => {
    const f = await fixture()
    await seed(f)
    Object.defineProperty(f.adapter, 'mode', { value: mode })
    const send = vi.fn()
    await sendRenewalNotices(pool, { adapter: f.adapter, mail: { send }, clock: () => day10 })
    await f.run()
    expect(send).not.toHaveBeenCalled()
    expect(await f.attempts()).toMatchObject([{ token_charge: false, status: 'redirected', notice_id: null }])
  })

  it.each(['none', 'queued', 'late', 'wrong_amount', 'wrong_date', 'wrong_currency', 'wrong_exponent', 'wrong_cadence', 'old_method', 'plan_off'] as const)(
    'uses hosted collection for %s notice evidence', async scenario => {
      const f = await fixture(scenario === 'plan_off' ? disabledPlan : paidPlan)
      if (scenario === 'old_method') {
        const old = randomUUID()
        await pool.query(`INSERT INTO payment_methods(id,subscription_id,provider,state,consent_at,consent_actor,consent_version)
          VALUES($1,$2,'simulator','closed','2026-11-01T00:00:00Z','fixture','fixture')`, [old,f.subscription])
        await seed(f, { method: old })
      } else if (scenario !== 'none') await seed(f, {
        sentAt: scenario === 'late' ? new Date(day7End + 1_000) : scenario === 'queued' ? null : undefined,
        minor: scenario === 'wrong_amount' ? price + 1 : undefined,
        currency: scenario === 'wrong_currency' ? 'USD' : undefined,
        exponent: scenario === 'wrong_exponent' ? 3 : undefined,
        cadenceCount: scenario === 'wrong_cadence' ? 2 : undefined,
        date: scenario === 'wrong_date' ? '2026-12-11' : undefined,
      })
      await f.run()
      expect(await f.attempts()).toMatchObject([{ token_charge: false, status: 'redirected', notice_id: null }])
    },
  )

  it('refuses to invent a receipt when upgrading a historical stored attempt', async () => {
    const migration = await readFile(new URL('../schema_047.sql', import.meta.url), 'utf8')
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      await db.query('CREATE TEMP TABLE payment_attempts(token_charge boolean)')
      await db.query('INSERT INTO payment_attempts VALUES(true)')
      await expect(db.query(migration)).rejects.toMatchObject({ message: 'stored_payment_notice_backfill_required' })
    } finally {
      await db.query('ROLLBACK')
      db.release()
    }
  })

  it('requires a linked notice at the database boundary', async () => {
    const f = await fixture()
    await f.run()
    await expect(pool.query(`UPDATE payment_attempts SET token_charge=true,method_id=$1,status='created',provider_ref=NULL,redirect_url=NULL
      WHERE order_id=(SELECT o.id FROM orders o WHERE o.subscription_id=$2 AND o.kind='renewal')`, [f.method,f.subscription]))
      .rejects.toMatchObject({ constraint: 'payment_attempts_notice_required' })
  })

  it('uses hosted for the first trial conversion even with exact stale notice evidence', async () => {
    const f = await fixture()
    await seed(f)
    await pool.query(`UPDATE subscriptions SET state='past_due',trial_ends_at='2026-12-10T00:00:00Z',trial_outcome='converted',
      trial_ended_at='2026-12-10T00:00:00Z',revision=revision+1 WHERE id=$1`, [f.subscription])
    await f.run()
    expect(await f.attempts()).toMatchObject([{ token_charge: false, status: 'redirected', notice_id: null }])
  })

  it('revalidates exact notice evidence under the dispatch lock', async () => {
    const f = await fixture()
    const id = await seed(f)
    await f.run()
    const [attempt] = await f.attempts()
    await pool.query('UPDATE renewal_notices SET cadence_count=2 WHERE id=$1', [id])
    expect(await claimForSend(pool, attempt.id)).toBeNull()
    expect(await f.attempts()).toMatchObject([{ status: 'created', token_charge: true }])
  })

  it('shows abandoned stored collection only to vendor billing readers while the order is unpaid', async () => {
    const f = await fixture()
    await seed(f)
    await f.run()
    const [attempt] = await f.attempts()
    await claimForSend(pool, attempt.id)
    await reconcileTokenCharges(pool, f.adapter, new Date(Date.now() + 86_401_000))
    expect((await attention(pool, true)).items).toContainEqual(expect.objectContaining({ kind: 'charge_abandoned' }))
    expect((await attention(pool, false)).items).not.toContainEqual(expect.objectContaining({ kind: 'charge_abandoned' }))
    await pool.query("UPDATE orders SET payment_state='paid' WHERE id=(SELECT order_id FROM payment_attempts WHERE id=$1)", [attempt.id])
    expect((await attention(pool, true)).items).not.toContainEqual(expect.objectContaining({ kind: 'charge_abandoned' }))
  })

  it('does not notify or reserve payment for a zero-due renewal', async () => {
    const f = await fixture(freePlan)
    const send = vi.fn(async (_message: MailMessage) => ({ accepted: true, provider_message_id: 'fixture' }))
    await sendRenewalNotices(pool, { adapter: f.adapter, mail: { send }, clock: () => day10 })
    expect(await f.notices()).toEqual([])
    expect(await f.run()).toMatchObject([{ payment_state: 'not_required' }])
    expect(await f.attempts()).toEqual([])
  })
})
