import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { ALERT_BURST_LIMIT, sendVendorAlerts, VENDOR_ALERT_KIND } from '../commercial/vendor-alerts.js'

const suite = url ? describe : describe.skip
suite('live PostgreSQL owner alerts', () => {
  const pool = new Pool({ connectionString: url, max: 6 }), api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  const env = { LIWAN_VENDOR_ALERT_EMAIL_TO: 'owner@example.test' }
  const origin = 'https://admin.example.test'
  let plan: any

  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Alert acceptance' })
    const c = await api('POST', '/plans', { name: `Alert ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {},
      included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason: 'Alert acceptance' })
    const published = await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason: 'Alert acceptance' }); plan = published.body
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox'); await pool.query('TRUNCATE audit_events') })
  afterAll(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox'); await pool.end() })

  const channels = (opts: { mailFails?: boolean; telegramFails?: boolean } = {}) => {
    const mails: any[] = [], texts: string[] = []
    return { mails, texts,
      mail: { send: async (m: any) => { if (opts.mailFails) throw new Error('smtp down'); mails.push(m); return { accepted: true, provider_message_id: 'p' } } },
      telegram: { send: async (t: string) => { if (opts.telegramFails) throw Object.assign(new Error('x'), { code: 'telegram_http_502' }); texts.push(t) } } }
  }
  const run = (ch: ReturnType<typeof channels>, extra: Record<string, unknown> = {}) =>
    sendVendorAlerts(pool, { now: new Date(), env, mail: ch.mail, telegram: ch.telegram, consoleOrigin: origin, log: () => {}, ...extra } as never)
  const alerts = async (event?: string) => (await pool.query("SELECT * FROM commercial_outbox WHERE kind=$1 AND ($2::text IS NULL OR payload->>'event'=$2) ORDER BY created_at", [VENDOR_ALERT_KIND, event ?? null])).rows
  const sentOf = (ch: ReturnType<typeof channels>, needle: string) => ch.mails.filter(m => m.text.includes(needle))

  async function lite(name = 'Alert customer') {
    const customer = randomUUID(), subscription = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, name, 'Manager', `${customer}@example.test`])
    await pool.query("INSERT INTO subscriptions(id,customer_id,state) VALUES($1,$2,'active')", [subscription, customer])
    return { customer, subscription }
  }
  async function unpaid() {
    const customer = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Transfer customer', tenant, 'Manager', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const invoice = (await pool.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued'", [order.id])).rows[0]
    return { customer, order, invoice, subscription: order.subscription_id as string }
  }
  const notice = (subscription: string, payload: object, key: string) => pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status) VALUES($1,'billing.notice',$2,$3,$4::jsonb,'done')", [randomUUID(), subscription, key, JSON.stringify({ subscription_id: subscription, ...payload })])

  it('announces every kind of fact once, in Arabic, with the customer, the amount and what to do', async () => {
    const a = await lite('Signup Co'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [a.customer, 'a@example.test', '+966500000001'])
    const b = await lite('Money Co')
    await notice(b.subscription, { type: 'payment_received', invoice_id: randomUUID(), amount: { minor: 11500, currency: 'SAR', exponent: 2 } }, 'p1')
    await notice(b.subscription, { type: 'overdue' }, 'o1')
    await notice(b.subscription, { type: 'suspended' }, 's1')
    for (const action of ['subscription.cancel_requested', 'subscription.cancel_withdrawn'])
      await pool.query("INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,'customer',$2,$3,'',$4::jsonb)", [randomUUID(), action, b.subscription, JSON.stringify({ effective_on: '2026-12-01' })])
    await pool.query("UPDATE subscriptions SET trial_outcome='free_base',trial_ended_at=now(),revision=revision+1 WHERE id=$1", [b.subscription])
    const late = await unpaid()
    await pool.query("UPDATE orders SET payment_state='not_required',created_at=now()-interval '1 hour' WHERE id=$1", [late.order.id])
    const t = await unpaid()
    await pool.query('INSERT INTO bank_transfer_claims(invoice_id,value_date,sender_reference) VALUES($1,$2,$3)', [t.invoice.id, '2026-11-12', 'REF-77'])
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      VALUES($1,$2,$3,'credit_note','Refund asked',5000,'SAR',2,'pending','vendor:7','vendor','vendor_refund')`, [randomUUID(), t.invoice.id, t.customer])
    const ch = channels()
    await run(ch)
    const events = (await alerts()).map(r => r.payload.event)
    for (const event of ['signup', 'payment_received', 'payment_overdue', 'subscription_suspended', 'cancel_requested', 'cancel_withdrawn', 'trial_free_base', 'bank_transfer_claimed', 'refund_requested', 'workspace_late'])
      expect(events.filter(e => e === event), event).toHaveLength(1)
    const paid = ch.mails.find(m => m.text.includes('دفعة مستلمة'))!
    expect(paid.text).toContain('Money Co'); expect(paid.text).toContain('115.00 SAR'); expect(paid.text).toContain('لا إجراء مطلوب')
    expect(paid.to).toBe('owner@example.test'); expect(paid.text).toContain(`${origin}/customers/${b.customer}`)
    const transfer = ch.mails.find(m => m.subject.includes('تحويل بنكي'))!
    expect(transfer.subject).toContain('[يتطلب إجراء]'); expect(transfer.text).toContain('REF-77'); expect(transfer.text).toContain('أكّد التحويل')
    expect(ch.mails.find(m => m.text.includes('ينتهي الاشتراك'))!.text).toContain('2026-12-01')
    expect(ch.texts.length).toBe(ch.mails.length)
    const before = [ch.mails.length, (await alerts()).length]
    await run(ch); await run(ch)
    expect([ch.mails.length, (await alerts()).length]).toEqual(before)
  })

  it('alerts when a refund fails or stalls and when a new item enters the attention list, and only once', async () => {
    const t = await unpaid()
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'reconcile.refund',$2,'k1',$3::jsonb,'failed',now())", [randomUUID(), t.order.id, JSON.stringify({ error: 'provider said no' })])
    const lonely = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [lonely, 'No subscription Co', 'M', 'm@example.test']) // setup_required
    const ch = channels()
    await run(ch)
    expect(await alerts('refund_rejected')).toHaveLength(1)
    expect(sentOf(ch, 'provider said no')[0].subject).toContain('[يتطلب إجراء]')
    const generic = await alerts('attention')
    expect(generic.length).toBeGreaterThanOrEqual(1)
    expect(generic.some(r => r.payload.text.includes('No subscription Co') && r.payload.text.includes('الإعداد التجاري لم يكتمل'))).toBe(true)
    const count = (await alerts()).length
    await run(ch)
    expect((await alerts()).length).toBe(count)
  })

  it('treats customer text as data: no markup, no extra lines, capped length', async () => {
    const t = await unpaid()
    const name = `<b>Evil</b> [x](http://evil.test) *y*\r\nBcc: spy@example.test\n${'z'.repeat(500)}`
    await pool.query('UPDATE customers SET name=$2 WHERE id=$1', [t.customer, name.replace(/[\r\n]/g, ' ')])
    await pool.query('INSERT INTO bank_transfer_claims(invoice_id,value_date,sender_reference) VALUES($1,$2,$3)', [t.invoice.id, '2026-11-12', `A‮B\u0007\nSecond line ${'q'.repeat(150)}`])
    const ch = channels(); await run(ch)
    const mail = ch.mails.find(m => m.subject.includes('تحويل بنكي'))!
    expect(mail.text.length).toBeLessThanOrEqual(1200)
    expect(mail.text).not.toMatch(/[‮\u0007]/)
    expect(mail.text).toContain('A B')
    expect(mail.text).not.toContain('\nSecond line'); expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(mail.text.split('\n').every((l: string) => l.length <= 260)).toBe(true)
    expect(ch.texts.find(x => x.includes('Evil'))).toBe(mail.text) // sent as given, plain; the sender adds no parse mode (adapter test)
  })

  it('collapses a burst of sign-ups into one summary and never announces a held one twice', async () => {
    for (let i = 0; i < ALERT_BURST_LIMIT + 3; i++) { const s = await lite(`Burst ${i}`); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [s.customer, `b${i}@example.test`, `+96650000${100 + i}`]) }
    const ch = channels(); await run(ch)
    const rows = await alerts('signup')
    expect(rows.filter(r => r.payload.summary)).toHaveLength(1)
    expect(rows.filter(r => r.payload.summarized)).toHaveLength(ALERT_BURST_LIMIT + 3)
    expect(ch.mails.filter(m => m.subject.includes('عملاء جدد'))).toHaveLength(1)
    expect(ch.mails.filter(m => m.text.includes('Burst '))).toHaveLength(0)
    const s = await lite('Late arrival'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [s.customer, 'late@example.test', '+966500000999'])
    const before = ch.mails.length
    await run(ch); await run(ch)
    expect(sentOf(ch, 'Late arrival')).toHaveLength(0)
    expect((await alerts('signup')).filter(r => r.payload.held)).toHaveLength(1)
    expect(ch.mails.filter(m => m.subject.includes('عملاء جدد'))).toHaveLength(1)
    expect(ch.mails.length).toBeGreaterThanOrEqual(before)
  })

  it('keeps one channel working when the other fails and retries only the failed one', async () => {
    const s = await lite('Retry Co'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [s.customer, 'r@example.test', '+966500000555'])
    const down = channels({ telegramFails: true }); await run(down)
    expect(sentOf(down, 'Retry Co')).toHaveLength(1)
    const row = (await alerts('signup'))[0]
    expect(row.status).toBe('pending'); expect(row.payload.sent_email).toBe(true); expect(row.payload.error).toContain('telegram: telegram_http_502'); expect(row.attempts).toBe(1)
    await pool.query("UPDATE commercial_outbox SET next_attempt_at=now() WHERE id=$1", [row.id])
    const up = channels(); await run(up)
    expect(up.texts.filter(t => t.includes('Retry Co'))).toHaveLength(1)
    expect(sentOf(up, 'Retry Co')).toHaveLength(0)
    expect((await alerts('signup'))[0].status).toBe('done')
    const mailDown = channels({ mailFails: true }); const t = await lite('Mail down Co'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [t.customer, 'm@example.test', '+966500000556'])
    await run(mailDown)
    expect(mailDown.texts.filter(x => x.includes('Mail down Co'))).toHaveLength(1)
  })

  it('completes the rows with a reason when no channel is configured, and honours the off switches', async () => {
    const s = await lite('Quiet Co'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [s.customer, 'q@example.test', '+966500000777'])
    const logs: string[] = []
    const ch = channels()
    await sendVendorAlerts(pool, { now: new Date(), env: {}, log: (m: string) => logs.push(m) } as never)
    const rows = await alerts('signup')
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('done'); expect(rows[0].payload.skipped).toBe('no_channel_configured')
    expect(logs.some(l => l.includes('no alert channel'))).toBe(true)
    const t = await lite('Switch Co'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [t.customer, 's@example.test', '+966500000778'])
    await run(ch, { env: { ...env, LIWAN_VENDOR_ALERT_TELEGRAM: 'off' } })
    expect(sentOf(ch, 'Switch Co')).toHaveLength(1); expect(ch.texts).toHaveLength(0)
    const u = await lite('Switch Two'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [u.customer, 'u@example.test', '+966500000779'])
    await run(ch, { env: { ...env, LIWAN_VENDOR_ALERT_EMAIL: 'off' } })
    expect(ch.texts.filter(x => x.includes('Switch Two'))).toHaveLength(1); expect(sentOf(ch, 'Switch Two')).toHaveLength(0)
  })

  it('leaves out the link when the vendor console origin is unknown and ignores facts older than the lookback', async () => {
    const s = await lite('Old Co'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [s.customer, 'old@example.test', '+966500000888'])
    await pool.query("UPDATE customers SET created_at=now()-interval '10 days' WHERE id=$1", [s.customer])
    const n = await lite('New Co'); await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [n.customer, 'new@example.test', '+966500000889'])
    const ch = channels(); await run(ch, { consoleOrigin: undefined })
    expect(sentOf(ch, 'Old Co').filter(m => m.subject.includes('عميل جديد'))).toHaveLength(0)
    const mail = ch.mails.find(m => m.subject.includes('عميل جديد') && m.text.includes('New Co'))!
    expect(mail.text).not.toContain('الرابط')
  })
})
