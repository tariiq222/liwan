import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly, seedPaymentMethod, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { generateRenewals, applyDunning } from '../commercial/renewals.js'
import { verifyReturnedAttempt } from '../commercial/payments.js'
import { daysText, sendBillingNotices, billingNotice } from '../commercial/billing-notices.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const suite = url ? describe : describe.skip
suite('live PostgreSQL billing notices', () => {
  const pool = new Pool({ connectionString: url, max: 6 }), api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  const now = new Date('2026-10-02T08:00:00Z')
  let suspend: any, free: any
  async function plan(auto_suspend: boolean, grace_days: number, price = 10000) {
    const c = await api('POST', '/plans', { name: `Notice ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(price) }], platform_limits: {},
      included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days, auto_suspend, auto_renew_allowed: true })
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason: 'Notice acceptance' })
    return (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason: 'Notice acceptance' })).body
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Notice acceptance' })
    suspend = await plan(true, 7); free = await plan(true, 7, 0)
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })
  async function subscription(renewalAt: string, p = suspend) {
    const customer = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, 'Notice customer', 'Manager', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: p.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at=$2,revision=revision+1 WHERE id=$1", [order.subscription_id, renewalAt])
    return { customer, id: order.subscription_id as string }
  }
  const mailbox = () => { const sent: any[] = []; return { sent, mail: { send: async (m: any) => { sent.push(m); return { accepted: true, provider_message_id: 'p' } } } } }
  const rows = async (type?: string) => (await pool.query("SELECT status,payload FROM commercial_outbox WHERE kind='billing.notice' AND ($1::text IS NULL OR payload->>'type'=$1) ORDER BY created_at", [type ?? null])).rows
  const returnOrigin = fixedReturnOrigin('https://liwan.test')

  it('sends the renewal notice once, links the subscription page and sends a missed threshold late', async () => {
    const s = await subscription('2026-10-05') // 3 days left
    const { sent, mail } = mailbox()
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(1)
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(`${s.customer}@example.test`)
    expect(sent[0].text).toContain('https://liwan.test/subscription')
    expect(sent[0].text).toContain('مساحة عملك: https://liwan.test')
    expect(sent[0].text).toContain('Your workspace: https://liwan.test')
    // Next day nothing is queued for threshold 3 again, but the missed threshold 1 is sent late (a day of downtime skipped 2 days).
    expect(await sendBillingNotices(pool, { now: new Date('2026-10-04T08:00:00Z'), mail, returnOrigin })).toBe(1)
    expect((await rows('renewal_upcoming')).map(r => r.status)).toEqual(['done', 'done'])
  })
  it('sends nothing for a renewal further than 7 days, due today, held by a lock or owing nothing', async () => {
    await subscription('2026-10-20')
    await subscription('2026-10-02')
    await subscription('2026-10-04', free)
    const { sent, mail } = mailbox()
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(0)
    expect(sent).toHaveLength(0)
    expect(await rows()).toHaveLength(0)
  })
  it('sends no renewal notice to a subscription held by a free-base lock', async () => {
    const s = await subscription('2026-10-05')
    const revision = (await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1', [s.id])).rows[0].applied_revision_id
    await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,trial_ended_at,cause,state)
      VALUES($1,$2,'2026-10-01',now(),'trial_end','pending')`, [s.id, revision])
    const { sent, mail } = mailbox()
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(0)
    expect(sent).toHaveLength(0)
    expect(await rows()).toHaveLength(0)
  })
  it('reads the day count correctly in Arabic and English', () => {
    expect([1, 2, 3, 10, 11, 30].map(n => daysText(n, 'ar'))).toEqual(['يوم واحد', 'يومان', '3 أيام', '10 أيام', '11 يومًا', '30 يومًا'])
    expect([1, 2, 7].map(n => daysText(n, 'en'))).toEqual(['1 day', '2 days', '7 days'])
    const text = billingNotice({ type: 'renewal_upcoming', subscription_id: randomUUID(), renewal_on: '2026-10-03' }, 1, true, null).text
    expect(text).toContain('(المتبقي يوم واحد)')
    expect(text).toContain('(1 day left)')
    expect(text).not.toContain('Your workspace')
    expect(billingNotice({ type: 'payment_received', subscription_id: randomUUID() }, 0, true, 'https://t1.liwan.test').text).toContain('Your workspace: https://t1.liwan.test')
  })
  it('says a suspended workspace is read-only until payment, in both languages', () => {
    const text = billingNotice({ type: 'suspended', subscription_id: randomUUID(), grace_ends_on: '2026-10-05' }, 0, true, null).text
    expect(text).toContain('للقراءة والتصدير فقط')
    expect(text).toContain('your workspace is read-only')
    for (const notice of [{ type: 'suspension_warning', subscription_id: randomUUID(), grace_ends_on: '2026-10-05' }, { type: 'overdue', subscription_id: randomUUID(), grace_ends_on: '2026-10-05' }] as const) {
      const warning = billingNotice(notice, 2, true, null).text
      expect(warning).toContain('للقراءة والتصدير فقط')
      expect(warning).toContain('read-only')
    }
  })
  it('does not send a renewal notice that stopped being true', async () => {
    const s = await subscription('2026-10-05')
    const { sent, mail } = mailbox()
    // Queue it, then cancel before the send: queue via a failing mail so the row stays pending.
    await sendBillingNotices(pool, { now, mail: { send: async () => { throw new Error('smtp_down') } }, returnOrigin })
    await pool.query("UPDATE subscriptions SET state='cancelled',revision=revision+1 WHERE id=$1", [s.id])
    await pool.query("UPDATE commercial_outbox SET next_attempt_at=now()")
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(0)
    expect(sent).toHaveLength(0)
    expect((await rows('renewal_upcoming'))[0]!.status).toBe('done')
  })
  it('keeps the row retryable when the mail fails', async () => {
    await subscription('2026-10-05')
    const { sent, mail } = mailbox()
    expect(await sendBillingNotices(pool, { now, mail: { send: async () => { throw new Error('smtp_down') } }, returnOrigin })).toBe(0)
    const [row] = await rows('renewal_upcoming')
    expect(row).toMatchObject({ status: 'pending', payload: { error: 'smtp_down' } })
    await pool.query("UPDATE commercial_outbox SET next_attempt_at=now()")
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(1)
    expect(sent).toHaveLength(1)
  })
  it('queues overdue and suspended notices in the dunning transaction and warns before suspension', async () => {
    const s = await subscription('2026-10-01')
    await generateRenewals(pool, { now, adapter: new SimulatorAdapter(), returnOrigin })
    const due = new Date((await pool.query('SELECT max(due_at) AS at FROM invoices WHERE subscription_id=$1', [s.id])).rows[0].at)
    const pastDue = new Date(due.getTime() + 1000)
    await applyDunning(pool, { now: pastDue })
    await applyDunning(pool, { now: pastDue })
    expect((await rows('overdue'))).toHaveLength(1)
    expect(await rows('suspended')).toHaveLength(0)
    const { sent, mail } = mailbox()
    expect(await sendBillingNotices(pool, { now: pastDue, mail, returnOrigin })).toBe(1)
    expect(sent[0].subject).toContain('لم تُسدَّد')
    // Grace is 7 days: 3 days before it ends, the warning goes once.
    const warn = new Date(due.getTime() + 4.5 * 86_400_000)
    expect(await sendBillingNotices(pool, { now: warn, mail, returnOrigin })).toBe(1)
    expect(await sendBillingNotices(pool, { now: warn, mail, returnOrigin })).toBe(0)
    expect((await rows('suspension_warning'))).toHaveLength(1)
    const after = new Date(due.getTime() + 8 * 86_400_000)
    await applyDunning(pool, { now: after })
    expect((await rows('suspended'))).toHaveLength(1)
    expect(await sendBillingNotices(pool, { now: after, mail, returnOrigin })).toBe(1)
    await applyDunning(pool, { now: after })
    expect(await rows('suspended')).toHaveLength(1)
  })
  it('does not send overdue or suspended notices once the invoice is paid', async () => {
    const s = await subscription('2026-10-01')
    await generateRenewals(pool, { now, adapter: new SimulatorAdapter(), returnOrigin })
    const due = new Date((await pool.query('SELECT max(due_at) AS at FROM invoices WHERE subscription_id=$1', [s.id])).rows[0].at)
    await applyDunning(pool, { now: new Date(due.getTime() + 1000) })
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE subscription_id=$1", [s.id])
    await pool.query("UPDATE subscriptions SET state='active',grace_ends_at=NULL,revision=revision+1 WHERE id=$1", [s.id])
    const { sent, mail } = mailbox()
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(0)
    expect(sent).toHaveLength(0)
  })
  it('acknowledges a paid subscription invoice once', async () => {
    const s = await subscription('2026-10-01')
    await seedPaymentMethod(pool, s.customer, 'token')
    await pool.query('UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=$2,revision=revision+1 WHERE id=$1', [s.id, now])
    const adapter = new SimulatorAdapter().addToken('token')
    await generateRenewals(pool, { now, adapter, returnOrigin })
    const attempt = (await pool.query('SELECT a.id FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.subscription_id=$1', [s.id])).rows[0]
    await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1", [attempt.id])
    await verifyReturnedAttempt(pool, { attempt_id: attempt.id, customer_id: s.customer, adapter })
    await verifyReturnedAttempt(pool, { attempt_id: attempt.id, customer_id: s.customer, adapter })
    expect(await rows('payment_received')).toHaveLength(1)
    const { sent, mail } = mailbox()
    expect(await sendBillingNotices(pool, { now, mail, returnOrigin })).toBe(1)
    expect(sent[0].subject).toBe('استلمنا دفعتك في LiwanOS')
    expect(sent[0].text).toContain('115.00 SAR')
  })
})
