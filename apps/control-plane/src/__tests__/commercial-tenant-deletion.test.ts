import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { TENANT_DELETION_WINDOW_DAYS, type Principal } from '@liwan/commercial-contracts'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { client, money, monthly, seedPaymentMethod, setup, url } from './commercial-helpers.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuoteOn } from '../commercial/orders.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { transaction } from '../db.js'
import { digestOf } from '../commercial/lifecycle.js'
import { customerHttp } from '../commercial/customer-http.js'
import { routesB } from '../commercial/routes-b.js'
import { attention } from '../commercial/attention.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { sendVendorAlerts } from '../commercial/vendor-alerts.js'
import { confirmDeletion, expireDeletionCodes, markDueDeletions, requestDeletion, withdrawDeletion } from '../commercial/tenant-deletion.js'
import { generateRenewals } from '../commercial/renewals.js'
import { processFreeBaseLocks } from '../commercial/free-base-lock.js'
import { sendTenantDeletionNotices } from '../commercial/tenant-deletion-notices.js'
import { TENANT_DELETION_REMINDER_DAYS } from '../commercial/notice-timings.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const suite = url ? describe : describe.skip
const DAY = 86_400_000

suite('a customer deletes its own workspace in two steps and the withdrawal window (owner decisions B8/O6 and 2026-11-13)', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const api = client(pool)
  const reason = 'Tenant deletion acceptance'
  const placed = new Date('2026-11-12T09:00:00Z')
    const adapter = new SimulatorAdapter()
  const origin = fixedReturnOrigin('https://liwan.test')
  const config = { installationId: 'del-vendor', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'del-customer', customerCommercialServiceKey: 'customer-test-key-'.repeat(4), inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
  const secret = 'deletion-secret-'.repeat(3)
  let plan: any, bundle: any

  beforeAll(async () => {
    const { version } = await setup(pool)
    const release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.features.some((f: any) => f.key === 'projects.max_projects'))
    const b = await api('POST', '/bundles', { name: `Deletion bundle ${randomUUID()}`, description: 'Test', audience: { kind: 'public' },
      catalog_release_id: release.id, selections: [{ app_id: app.id, feature_keys: ['pmo.enabled'] }], domain_limits: { 'projects.max_projects': 10 },
      prices: [{ cadence: monthly, amount: money(19900) }] })
    const bv = await api('POST', `/bundles/${b.body.id}/validate`, { edit_revision: 1, reason })
    bundle = (await api('POST', `/bundles/${b.body.id}/publish`, { edit_revision: bv.body.edit_revision, reason })).body
    const p = await api('POST', '/plans', { name: `Deletion ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY, trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    expect(p.status, JSON.stringify(p.body)).toBe(201)
    const pv = await api('POST', `/plans/${p.body.id}/validate`, { edit_revision: 1, reason })
    plan = (await api('POST', `/plans/${p.body.id}/publish`, { edit_revision: pv.body.edit_revision, reason })).body
  })
  beforeEach(async () => { await pool.query('TRUNCATE commercial_outbox'); await pool.query('TRUNCATE tenant_deletion_requests') })
  afterAll(async () => { await pool.end() })

  const request = () => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [bundle.id], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 })
  const mails: { to: string; subject: string; text: string }[] = []
  const mail = { send: async (m: any) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } }
  const mailsTo = (f: { customer: string }) => mails.filter(m => m.to === `${f.customer}@example.test`)
  const codeOf = (text: string) => /\b(\d{6})\b/.exec(text)![1]!
  const row = async (customer: string) => (await pool.query('SELECT * FROM tenant_deletion_requests WHERE customer_id=$1 ORDER BY requested_at DESC', [customer])).rows[0]
  const audits = async (customer: string, action: string) => (await pool.query('SELECT actor,reason,metadata FROM audit_events WHERE subject=$1 AND action=$2 ORDER BY created_at', [customer, action])).rows

  async function tenantFor(name: string) {
    const customer = randomUUID(), tenant = randomUUID()
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,post_trial_supported,excess_supported) VALUES($1,$2,'saas','shared_managed',$3,true,true,true)", [tenant, name, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, name, tenant, 'Manager', `${customer}@example.test`])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    return { customer, tenant, name, principal }
  }
  /** A customer who bought the paid configuration outright: paid and delivered, renewing on `renewal_at`. */
  async function paidCustomer(name = `Paid ${randomUUID().slice(0, 8)}`) {
    const f = await tenantFor(name)
    const quote = await createQuoteForCustomer(pool, { customer_id: f.customer, request: request() }, placed)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    const { order } = await transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, f.principal, placed))
    const attempt = await createPaymentAttempt(pool, { order_id: order.id, customer_id: f.customer, adapter, returnOrigin: origin })
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter })
    await pool.query(`UPDATE subscriptions s SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',
      renewal_at=(r.snapshot->>'period_end')::date,revision=s.revision+1 FROM subscription_revisions r WHERE r.id=s.target_revision_id AND s.customer_id=$1`, [f.customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE commercial_outbox SET status='done' WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])
    const sub = (await pool.query('SELECT id FROM subscriptions WHERE customer_id=$1', [f.customer])).rows[0]
    return { ...f, subscription: sub.id as string }
  }
  type Fixture = Awaited<ReturnType<typeof tenantFor>>
  const who = { actor: '7', client_address: '203.0.113.9' }
  const ask = (f: Fixture) => requestDeletion(pool, { ...who, customer_id: f.customer, secret })
  const confirm = (f: Fixture, code: string, name = f.name) => confirmDeletion(pool, { ...who, customer_id: f.customer, code, company_name: name, secret })
  const send = () => sendTenantDeletionNotices(pool, { mail })
  /** Everything in the module runs on the database clock, so time passes by moving the recorded moments of one customer into the past. */
  const age = async (f: Fixture, ms: number) => {
    await pool.query(`UPDATE tenant_deletion_requests SET requested_at=requested_at - make_interval(secs => $2), code_expires_at=code_expires_at - make_interval(secs => $2),
      confirmed_at=confirmed_at - make_interval(secs => $2), due_at=due_at - make_interval(secs => $2), due_marked_at=due_marked_at - make_interval(secs => $2),
      withdrawn_at=withdrawn_at - make_interval(secs => $2) WHERE customer_id=$1`, [f.customer, ms / 1000])
    await pool.query('UPDATE audit_events SET created_at=created_at - make_interval(secs => $2) WHERE subject=$1', [f.customer, ms / 1000])
  }
  /** The scheduled date is `days` away (negative: that long ago). */
  const dueIn = (f: Fixture, days: number) => pool.query("UPDATE tenant_deletion_requests SET due_at=now() + make_interval(secs => $2) WHERE customer_id=$1 AND state='confirmed'", [f.customer, days * DAY / 1000])
  /** Request, read the code from the mail the worker sends, confirm. */
  async function confirmed(f: Fixture) {
    await ask(f)
    await send()
    const code = codeOf(mailsTo(f).at(-1)!.text)
    return { code, view: await confirm(f, code) }
  }
  const refused = async (work: Promise<unknown>) => work.then(() => null, (e: any) => ({ code: e.code, status: e.status }))

  /** The signed customer route, as the web server calls it. */
  async function route(f: Fixture, method: string, path: string, body?: unknown, capabilities = ['subscription.read', 'subscription.manage', 'tenant.delete'], address = '203.0.113.9', sent?: string) {
    const raw = body === undefined ? '' : JSON.stringify(body)
    const header = Buffer.from(JSON.stringify({ actor_id: '7', kind: 'customer', tenant_id: f.tenant, capabilities })).toString('base64')
    const signed = signServiceRequest({ method, path, body: `liwan-principal:${header}\nliwan-client:${address}\n${raw}`, actor: 7, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
    return customerHttp(pool, config as never, { method, path, raw, headers: { ...signed, 'x-liwan-principal': header, 'x-liwan-client-ip': sent ?? address, 'content-type': 'application/json' } as never })
      .then(r => r as { status: number; data: any }, (e: any) => ({ status: e.status as number, data: { code: e.code as string } }))
  }
  const vendorCall = (method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) =>
    routesB(pool, { method, pathname: `/v1/commercial${path.split('?')[0]}`, raw: body === undefined ? '' : JSON.stringify(body), issuer: 'del-test', actor: 7,
      capabilities: ['vendor.read', 'vendor.subscriptions.manage'], stepUpFresh: true, clientAddress: '198.51.100.4', ...extra } as never, new URL(`http://x/v1/commercial${path}`))
    .then(r => r as { status: number; data: any } | null, (e: any) => ({ status: e.status as number, data: { code: e.code as string } }))

  it('turns automatic renewal off when the deletion is confirmed, keeps the card, and writes the audit event', async () => {
    const f = await paidCustomer()
    const cardId = await seedPaymentMethod(pool, f.customer, `tok_${randomUUID()}`)
    await pool.query('UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=now(),revision=revision+1 WHERE customer_id=$1', [f.customer])
    await confirmed(f)
    expect((await pool.query('SELECT auto_renew_enabled FROM subscriptions WHERE customer_id=$1', [f.customer])).rows[0].auto_renew_enabled).toBe(false)
    expect((await pool.query('SELECT status,is_default FROM payment_methods WHERE id=$1', [cardId])).rows[0]).toEqual({ status: 'active', is_default: true })
    expect(await audits(f.subscription, 'auto_renew.disabled')).toEqual([expect.objectContaining({ actor: '7', reason: expect.stringContaining('Workspace deletion confirmed') })])
    // Withdrawing the deletion does not switch it back on: the customer decides that.
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'customer', reason: null })
    expect((await pool.query('SELECT auto_renew_enabled FROM subscriptions WHERE customer_id=$1', [f.customer])).rows[0].auto_renew_enabled).toBe(false)
  })

  it('sends the code only to the address on record, keeps only its hash, and confirms with the exact company name', async () => {
    const f = await paidCustomer()
    mails.length = 0
    const view = await ask(f)
    expect(view).toMatchObject({ state: 'requested', confirmed_at: null, due_at: null })
    const asked = await row(f.customer)
    expect(new Date(view.code_expires_at!).getTime() - asked.requested_at.getTime()).toBe(15 * 60_000)
    // The raw code is in the queued mail and nowhere durable once it has been sent.
    await send()
    expect(mailsTo(f)).toHaveLength(1)
    expect(mails.every(m => m.to === `${f.customer}@example.test`)).toBe(true)
    const code = codeOf(mailsTo(f)[0]!.text)
    expect(mailsTo(f)[0]!.text).toContain(f.name)
    const stored = await row(f.customer)
    expect(stored.code_hash).toHaveLength(32)
    expect(stored.code_hash.toString('utf8')).not.toContain(code)
    const everywhere = JSON.stringify((await pool.query('SELECT payload FROM commercial_outbox')).rows) + JSON.stringify((await pool.query('SELECT metadata,reason FROM audit_events')).rows)
    expect(everywhere).not.toContain(`"code":"${code}"`)
    expect(everywhere).not.toMatch(new RegExp(`\\b${code}\\b`))
    expect(await audits(f.customer, 'tenant_deletion.requested')).toMatchObject([{ actor: '7', metadata: { client_address: '203.0.113.9' } }])

    const done = await confirm(f, code)
    const confirmedRow = await row(f.customer)
    expect(done).toMatchObject({ state: 'confirmed', code_expires_at: null, confirmed_at: confirmedRow.confirmed_at.toISOString(), due_at: new Date(confirmedRow.confirmed_at.getTime() + TENANT_DELETION_WINDOW_DAYS * DAY).toISOString() })
    expect(confirmedRow.code_hash).toBeNull()
    expect(await audits(f.customer, 'tenant_deletion.confirmed')).toMatchObject([{ actor: '7', metadata: { client_address: '203.0.113.9', renewal_outcome: 'cancelled' } }])
    expect((await getSubscription(pool, f.customer)).deletion).toEqual(done)
  })

  it('answers every wrong, expired, used or exhausted code the same, counts tries, and refuses a wrong company name', async () => {
    const f = await paidCustomer('Exact Name Co')
    await ask(f)
    await send()
    const code = codeOf(mailsTo(f).at(-1)!.text)
    const wrong = code === '000000' ? '111111' : '000000'
    expect(await refused(confirm(f, wrong))).toEqual({ code: 'invalid_code', status: 422 })
    expect((await row(f.customer)).code_attempts).toBe(1)
    // The right code with the wrong name is refused by name and stays usable; case and spacing count.
    for (const name of ['exact name co', 'Exact Name Co ', 'Exact Name']) expect(await refused(confirm(f, code, name))).toEqual({ code: 'company_name_mismatch', status: 422 })
    for (let i = 0; i < 4; i++) await refused(confirm(f, wrong))
    expect((await row(f.customer)).code_attempts).toBe(5)
    expect(await refused(confirm(f, code))).toEqual({ code: 'invalid_code', status: 422 })
    expect((await row(f.customer)).state).toBe('requested')

    // Expired: a code works for 14 minutes and not at 15; a new one restarts the count.
    await age(f, 5 * 60_000)
    await ask(f)
    await send()
    const second = codeOf(mailsTo(f).at(-1)!.text)
    expect((await row(f.customer)).code_attempts).toBe(0)
    expect(await refused(confirm(f, code))).toEqual({ code: 'invalid_code', status: 422 })
    await age(f, 15 * 60_000)
    expect(await refused(confirm(f, second))).toEqual({ code: 'invalid_code', status: 422 })
    await age(f, 2 * 60_000)
    await ask(f)
    await send()
    const third = codeOf(mailsTo(f).at(-1)!.text)
    await age(f, 14 * 60_000)
    expect(await confirm(f, third)).toMatchObject({ state: 'confirmed' })
    // Single use.
    expect(await refused(confirm(f, third))).toEqual({ code: 'invalid_code', status: 422 })
    // Nothing to confirm for a customer that never asked.
    const other = await tenantFor('Never asked')
    expect(await refused(confirm(other, '123456'))).toEqual({ code: 'invalid_code', status: 422 })
  })

  it('limits new codes to one a minute and five an hour per customer, and a customer has one open request', async () => {
    const f = await paidCustomer()
    await ask(f)
    expect(await refused(ask(f))).toEqual({ code: 'rate_limited', status: 429 })
    for (let i = 1; i < 5; i++) { await age(f, 61_000); await ask(f) }
    await age(f, 61_000)
    expect(await refused(ask(f))).toEqual({ code: 'rate_limited', status: 429 })
    expect((await pool.query('SELECT count(*)::int AS n FROM tenant_deletion_requests WHERE customer_id=$1', [f.customer])).rows[0].n).toBe(1)
    expect((await row(f.customer)).code_seq).toBe(5)
    // After the hour a new code is allowed again, still on the same request.
    await age(f, 61 * 60_000)
    expect(await ask(f)).toMatchObject({ state: 'requested' })
    await expect(pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by) VALUES($1,$2,'requested',now(),'7')`, [randomUUID(), f.customer])).rejects.toMatchObject({ code: '23505' })
    // Once the clock runs, asking again is refused.
    await pool.query(`UPDATE tenant_deletion_requests SET code_hash=NULL,code_expires_at=NULL,state='confirmed',confirmed_at=now(),confirmed_by='7',due_at=now()+interval '${TENANT_DELETION_WINDOW_DAYS} days',renewal_outcome='cancelled' WHERE customer_id=$1`, [f.customer])
    await age(f, 3_600_000)
    expect(await refused(ask(f))).toEqual({ code: 'deletion_pending', status: 409 })
  })

  it('starts one clock when two managers confirm at the same moment', async () => {
    const f = await paidCustomer()
    await ask(f)
    await send()
    const code = codeOf(mailsTo(f).at(-1)!.text)
    const results = await Promise.all([confirm(f, code), confirm(f, code)].map(p => p.then(() => 'ok', (e: any) => e.code as string)))
    expect(results.sort()).toEqual(['invalid_code', 'ok'])
    expect(await audits(f.customer, 'tenant_deletion.confirmed')).toHaveLength(1)
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='tenant_deletion.notice' AND payload->>'type'='confirmed'")).rows[0].n).toBe(1)
  })

  it('stops the paid renewal on confirm without a refund, leaves one that cannot be cancelled, and never resumes it on withdrawal', async () => {
    const paid = await paidCustomer()
    const before = (await pool.query('SELECT renewal_at::text AS on,state FROM subscriptions WHERE customer_id=$1', [paid.customer])).rows[0]
    const credits = async () => (await pool.query('SELECT count(*)::int AS n FROM invoice_adjustments WHERE customer_id=$1', [paid.customer])).rows[0].n
    const creditsBefore = await credits()
    await confirmed(paid)
    const s = (await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [paid.customer])).rows[0]
    expect(s).toMatchObject({ state: before.state, cancel_requested_by: 'customer' })
    expect(await row(paid.customer)).toMatchObject({ renewal_outcome: 'cancelled', renewal_refusal: null })
    expect(await credits()).toBe(creditsBefore)
    // The cancellation sends no notice of its own: the deletion notice already says it.
    expect((await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='cancellation.notice'")).rows[0].n).toBe(0)
    await withdrawDeletion(pool, { ...who, customer_id: paid.customer, by: 'customer', reason: null })
    expect((await pool.query('SELECT cancel_requested_at FROM subscriptions WHERE customer_id=$1', [paid.customer])).rows[0].cancel_requested_at).not.toBeNull()

    // Not cancellable (a trial), the deletion is still accepted and the reason is recorded.
    const trial = await paidCustomer()
    await pool.query("UPDATE subscriptions SET state='trialing',revision=revision+1 WHERE customer_id=$1", [trial.customer])
    await confirmed(trial)
    expect(await row(trial.customer)).toMatchObject({ state: 'confirmed', renewal_outcome: 'not_cancellable', renewal_refusal: 'cancel_trial_unsupported' })
    expect((await pool.query('SELECT cancel_requested_at FROM subscriptions WHERE customer_id=$1', [trial.customer])).rows[0].cancel_requested_at).toBeNull()

    // Already cancelled by the customer earlier: nothing more to do.
    const early = await paidCustomer()
    await pool.query("UPDATE subscriptions SET cancel_requested_at=now(),cancel_requested_by='customer',revision=revision+1 WHERE customer_id=$1", [early.customer])
    await confirmed(early)
    expect(await row(early.customer)).toMatchObject({ renewal_outcome: 'already_cancelled' })

    // The free base has no subscription to cancel.
    const free = await tenantFor('Free base customer')
    await confirmed(free)
    expect(await row(free.customer)).toMatchObject({ state: 'confirmed', renewal_outcome: 'not_cancellable', renewal_refusal: 'no_subscription' })
  })

  it('opens no new paid period for a tenant whose deletion is confirmed, and says plainly when the renewal could not be stopped', async () => {
    const renewalDay = async (f: { subscription: string }) => (await pool.query('SELECT renewal_at::text AS on FROM subscriptions WHERE id=$1', [f.subscription])).rows[0].on as string
    const generate = (day: string) => generateRenewals(pool, { now: new Date(`${day}T09:00:00Z`), returnOrigin: origin })
    const renewalsOf = async (f: { subscription: string }) => (await pool.query("SELECT count(*)::int AS n FROM renewals WHERE subscription_id=$1 AND status<>'superseded'", [f.subscription])).rows[0].n
    // A past-due tenant cannot have its renewal cancelled: the deletion is accepted, the renewal still is not generated.
    const blocked = await paidCustomer()
    const control = await paidCustomer()
    for (const f of [blocked, control]) await pool.query("UPDATE subscriptions SET state='past_due',revision=revision+1 WHERE id=$1", [f.subscription])
    await confirmed(blocked)
    expect(await row(blocked.customer)).toMatchObject({ renewal_outcome: 'not_cancellable', renewal_refusal: 'subscription_past_due' })
    const day = await renewalDay(blocked)
    await generate(day)
    expect(await renewalsOf(blocked)).toBe(0)
    expect(await renewalsOf(control)).toBe(1)
    // The same holds once the request is due; a withdrawn request renews as usual.
    await dueIn(blocked, -1); await markDueDeletions(pool)
    await generate(day)
    expect(await renewalsOf(blocked)).toBe(0)
    const lifted = await paidCustomer()
    await pool.query("UPDATE subscriptions SET state='past_due',revision=revision+1 WHERE id=$1", [lifted.subscription])
    await confirmed(lifted)
    await withdrawDeletion(pool, { ...who, customer_id: lifted.customer, by: 'customer', reason: null })
    await generate(await renewalDay(lifted))
    expect(await renewalsOf(lifted)).toBe(1)
    // A cancel that was recorded drops the tenant to the free base through the existing cancelled lock at the renewal date.
    const stopped = await paidCustomer()
    await confirmed(stopped)
    const stoppedDay = await renewalDay(stopped)
    expect(await generate(stoppedDay)).toHaveLength(0)
    await processFreeBaseLocks(pool, { now: new Date(`${stoppedDay}T09:00:00Z`), adapter, subscription_id: stopped.subscription })
    expect((await pool.query('SELECT cause FROM free_base_locks WHERE subscription_id=$1', [stopped.subscription])).rows[0]).toMatchObject({ cause: 'cancelled' })

    // The customer's notice and the owner's alert both say the renewal was not stopped and why, in words.
    await send()
    const confirmedMail = mailsTo(blocked).find(m => m.subject.includes('جدولنا'))!
    expect(confirmedMail.text).toContain('لم نوقف تجديد اشتراكك المدفوع لأن عليك فاتورة متأخرة')
    expect(confirmedMail.text).toContain('did not stop your paid subscription from renewing because an invoice is overdue')
    expect(confirmedMail.text).not.toContain('subscription_past_due')
    const alerts: string[] = []
    await sendVendorAlerts(pool, { now: new Date(), env: { LIWAN_VENDOR_ALERT_EMAIL_TO: 'owner@example.test' }, mail: { send: async () => ({ accepted: true, provider_message_id: 'p' }) },
      telegram: { send: async (t: string) => { alerts.push(t) } }, consoleOrigin: 'https://admin.example.test', log: () => {} } as never)
    const alert = alerts.find(t => t.includes(blocked.name) && t.includes('أكّد حذف'))!
    expect(alert).toContain('لم يُوقف تجديد الاشتراك لأن عليك فاتورة متأخرة')
    expect(alert).not.toContain('subscription_past_due')
    const calm = alerts.find(t => t.includes(stopped.name) && t.includes('أكّد حذف'))!
    expect(calm).not.toContain('لم يُوقف تجديد')
  })

  it('withdraws for the customer and for the vendor, audited and notified, any time before due, and asks again afterwards', async () => {
    const f = await paidCustomer()
    mails.length = 0
    await confirmed(f)
    await withdrawDeletion(pool, { ...who, actor: '9', customer_id: f.customer, by: 'customer', reason: 'Mistake' })
    expect(await row(f.customer)).toMatchObject({ state: 'withdrawn', withdrawn_by: 'customer', withdrawn_actor: '9', withdrawn_from: '203.0.113.9', withdraw_reason: 'Mistake' })
    expect(await audits(f.customer, 'tenant_deletion.withdrawn')).toMatchObject([{ actor: '9', reason: 'Mistake', metadata: { by: 'customer', was: 'confirmed', client_address: '203.0.113.9' } }])
    // Asking again changes nothing; the countdown is gone.
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'customer', reason: null })
    expect(await audits(f.customer, 'tenant_deletion.withdrawn')).toHaveLength(1)
    expect((await getSubscription(pool, f.customer)).deletion).toBeNull()
    await send(); await send()
    expect(mailsTo(f).map(m => m.subject).filter(s => s.includes('سُحب'))).toHaveLength(1)
    expect(mailsTo(f).at(-1)!.text).toContain('Subscription')
    // A new request after a withdrawal is a new row; the withdrawn one stays as history.
    await age(f, 120_000)
    await ask(f)
    expect((await pool.query('SELECT state FROM tenant_deletion_requests WHERE customer_id=$1 ORDER BY requested_at', [f.customer])).rows.map(r => r.state)).toEqual(['withdrawn', 'requested'])
    // The vendor withdraws the request on the customer's behalf, with a reason and a fresh step-up.
    expect(await vendorCall('POST', `/customers/${f.customer}/deletion/withdraw`, { reason: 'Customer called' }, { stepUpFresh: false })).toMatchObject({ status: 403, data: { code: 'step_up_required' } })
    expect(await vendorCall('POST', `/customers/${f.customer}/deletion/withdraw`, { reason: 'x' })).toMatchObject({ status: 422 })
    expect(await vendorCall('POST', `/customers/${f.customer}/deletion/withdraw`, { reason: 'Customer called' }, { capabilities: ['vendor.read'] })).toMatchObject({ status: 403 })
    const vendor = await vendorCall('POST', `/customers/${f.customer}/deletion/withdraw`, { reason: 'Customer called' })
    expect(vendor).toMatchObject({ status: 200, data: { deletion: { state: 'withdrawn', withdrawn_by: 'vendor', withdraw_reason: 'Customer called' } } })
    expect((await audits(f.customer, 'tenant_deletion.withdrawn')).find(a => a.metadata.by === 'vendor')).toMatchObject({ reason: 'Customer called', metadata: { by: 'vendor', was: 'requested', client_address: '198.51.100.4' } })
  })

  it('moves a confirmed request to due at the end of the window by the database clock and no sooner, once, and then stops without touching the tenant', async () => {
    const f = await paidCustomer()
    const { view } = await confirmed(f)
    const confirmedRow = await row(f.customer)
    expect(new Date(view.due_at!).getTime() - confirmedRow.confirmed_at.getTime()).toBe(TENANT_DELETION_WINDOW_DAYS * DAY)
    const tenantBefore = JSON.stringify((await pool.query('SELECT * FROM tenants WHERE id=$1', [f.tenant])).rows)
    const operationsBefore = (await pool.query('SELECT count(*)::int AS n FROM operations WHERE tenant_id=$1', [f.tenant])).rows[0].n
    // A minute short of the window: not due. The process clock plays no part.
    await age(f, TENANT_DELETION_WINDOW_DAYS * DAY - 60_000)
    expect(await markDueDeletions(pool)).toBe(0)
    expect((await row(f.customer)).state).toBe('confirmed')
    await age(f, 61_000)
    expect(await markDueDeletions(pool)).toBe(1)
    expect(await markDueDeletions(pool)).toBe(0)
    const dueRow = await row(f.customer)
    expect(dueRow).toMatchObject({ state: 'due' })
    expect(dueRow.due_marked_at).toBeInstanceOf(Date)
    expect(await audits(f.customer, 'tenant_deletion.due')).toMatchObject([{ actor: 'system:tenant-deletion' }])
    expect((await getSubscription(pool, f.customer)).deletion).toMatchObject({ state: 'due', due_at: dueRow.due_at.toISOString() })
    expect(JSON.stringify((await pool.query('SELECT * FROM tenants WHERE id=$1', [f.tenant])).rows)).toBe(tenantBefore)
    expect((await pool.query('SELECT count(*)::int AS n FROM operations WHERE tenant_id=$1', [f.tenant])).rows[0].n).toBe(operationsBefore)
    // Too late to withdraw, for the customer and for the vendor.
    expect(await refused(withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'customer', reason: null }))).toEqual({ code: 'deletion_due', status: 409 })
    expect(await vendorCall('POST', `/customers/${f.customer}/deletion/withdraw`, { reason: 'Too late' })).toMatchObject({ status: 409, data: { code: 'deletion_due' } })
    expect(await refused(ask(f))).toEqual({ code: 'deletion_pending', status: 409 })
    // It waits in the vendor's attention list until handled.
    const item = (await attention(pool, true)).items.find(i => i.kind === 'tenant_deletion_due' && i.customer_id === f.customer)
    expect(item).toMatchObject({ tenant_id: f.tenant, name: f.name, since: new Date(Math.floor(dueRow.due_at.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z') })
  })

  it('scrubs an expired code from a mail that keeps failing and clears the request, without waiting for the mailer', async () => {
    const f = await paidCustomer()
    await ask(f)
    const failing = { send: async () => { throw new Error('smtp down') } }
    await sendTenantDeletionNotices(pool, { mail: failing })
    const pending = async () => (await pool.query("SELECT status,payload FROM commercial_outbox WHERE kind='tenant_deletion.notice' AND payload->>'type'='requested'")).rows[0]
    expect(await pending()).toMatchObject({ status: 'pending', payload: { code: expect.stringMatching(/^\d{6}$/) } })
    // Inside its 15 minutes the code stays, because the mail may still go out.
    await age(f, 14 * 60_000)
    expect(await expireDeletionCodes(pool)).toBe(0)
    expect(await pending()).toMatchObject({ status: 'pending' })
    expect((await row(f.customer)).code_hash).not.toBeNull()
    await pool.query('UPDATE tenant_deletion_requests SET code_attempts=3 WHERE customer_id=$1', [f.customer])
    await age(f, 2 * 60_000)
    expect(await expireDeletionCodes(pool)).toBe(1)
    const closed = await pending()
    expect(closed).toMatchObject({ status: 'failed', payload: { error: 'code_expired' } })
    expect(closed.payload).not.toHaveProperty('code')
    expect(await row(f.customer)).toMatchObject({ state: 'requested', code_hash: null, code_expires_at: null, code_attempts: 0 })
    expect(await refused(confirm(f, '123456'))).toEqual({ code: 'invalid_code', status: 422 })
    // The customer can ask again straight away after the cooldown, on the same request.
    await age(f, 120_000)
    expect(await ask(f)).toMatchObject({ state: 'requested' })
    expect((await row(f.customer)).code_seq).toBe(2)
    expect(await expireDeletionCodes(pool)).toBe(0)
  })

  it('sends each customer notice once at the right time, true to what has happened, the nearest reminder after an outage, and skips stale ones', async () => {
    const f = await paidCustomer()
    mails.length = 0
    const { view } = await confirmed(f)
    const dueOn = view.due_at!.slice(0, 10)
    const texts = () => mailsTo(f).map(m => m.text)
    await send()
    expect(mailsTo(f)).toHaveLength(2)
    // Confirmed: scheduled, nothing deleted yet, the date, what is deleted and kept, how to withdraw, in Arabic then English.
    const confirmedText = mailsTo(f)[1]!.text
    expect(mailsTo(f)[1]!.subject).toBe('جدولنا حذف مساحة العمل في LiwanOS')
    expect(confirmedText).toContain('لم يُحذف شيء حتى الآن')
    expect(confirmedText).toContain('Nothing has been deleted yet')
    expect(confirmedText).toContain('scheduled for deletion')
    expect(confirmedText.indexOf('يحذف فريق ليوان')).toBeLessThan(confirmedText.indexOf('the LiwanOS team deletes'))
    expect(confirmedText).toContain('invoices and payment records')
    expect(confirmedText).toContain('Subscription in LiwanOS (Delete workspace)')
    expect(confirmedText).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(confirmedText).not.toContain('is being carried out')
    expect(dueOn).toMatch(/^\d{4}-/)
    // Nothing while more days remain than the earliest reminder, then each threshold exactly once however often the worker runs.
    const [first, ...later] = [...TENANT_DELETION_REMINDER_DAYS]
    for (const d of [TENANT_DELETION_WINDOW_DAYS - 1, first! + 20, first! + 1]) { await dueIn(f, d); await send() }
    expect(mailsTo(f)).toHaveLength(2)
    let sentSoFar = 2
    for (const threshold of [first!, ...later]) {
      for (const d of [threshold, threshold, threshold - 1]) { await dueIn(f, d); await send() }
      sentSoFar++
      expect(mailsTo(f)).toHaveLength(sentSoFar)
      expect(texts()[sentSoFar - 1]).toContain(threshold === 1 ? '1 day' : `${threshold} days`)
      expect(texts()[sentSoFar - 1]).toContain('scheduled for deletion')
    }
    // The due moment says the window ended, withdrawal is over and the team will carry it out and confirm; it never says it is done or under way.
    await dueIn(f, -1); await markDueDeletions(pool)
    await send(); await send()
    expect(mailsTo(f)).toHaveLength(sentSoFar + 1)
    const dueText = texts()[sentSoFar]!
    expect(mailsTo(f)[sentSoFar]!.subject).toBe('انتهت مهلة حذف مساحة العمل في LiwanOS')
    expect(dueText).toContain('لم يعد سحب الطلب ممكنًا')
    expect(dueText).toContain('سينفّذ فريق ليوان الحذف، وسنرسل لك تأكيدًا عند اكتماله')
    expect(dueText).toContain('can no longer be withdrawn')
    expect(dueText).toContain('will carry out the deletion and we will send you a confirmation when it is complete')
    expect(dueText).not.toContain('being carried out')

    // A worker that was down: only the nearest reminder still ahead goes out, never the missed ones in a batch.
    const g = await paidCustomer()
    await confirmed(g)
    await send()
    await dueIn(g, 5); await send()
    expect(mailsTo(g)).toHaveLength(3)
    expect(mailsTo(g)[2]!.text).toContain('5 days')
    expect((await pool.query("SELECT dedupe_key FROM commercial_outbox WHERE kind='tenant_deletion.notice' AND payload->>'type'='reminder' AND aggregate_id=$1", [(await row(g.customer)).id])).rows).toHaveLength(1)

    // A reminder queued for a request that was withdrawn before it was sent never goes out.
    const h = await paidCustomer()
    await confirmed(h)
    await send()
    await dueIn(h, 7)
    const count = mailsTo(h).length
    await sendTenantDeletionNotices(pool, { mail: { send: async () => { throw new Error('smtp down') } } })
    await withdrawDeletion(pool, { ...who, customer_id: h.customer, by: 'vendor', reason: 'Support' })
    await send()
    expect(mailsTo(h)).toHaveLength(count + 1)
    expect(mailsTo(h).at(-1)!.subject).toContain('سُحب')
  })

  it('tells the owner about the request, the confirmation, the withdrawal and the due date once each, and the due one needs action', async () => {
    const f = await paidCustomer()
    const channel = { mails: [] as any[], texts: [] as string[] }
    const mailer = { send: async (m: any) => { channel.mails.push(m); return { accepted: true, provider_message_id: 'p' } } }
    const telegram = { send: async (t: string) => { channel.texts.push(t) } }
    const run = () => sendVendorAlerts(pool, { now: new Date(), env: { LIWAN_VENDOR_ALERT_EMAIL_TO: 'owner@example.test' }, mail: mailer, telegram, consoleOrigin: 'https://admin.example.test', log: () => {} } as never)
    const alertsFor = (needle: string) => channel.texts.filter(t => t.includes(f.name) && t.includes(needle))
    await ask(f)
    await run(); await run()
    expect(alertsFor('طلب حذف مساحته')).toHaveLength(1)
    await send()
    await confirm(f, codeOf(mailsTo(f).at(-1)!.text))
    await run(); await run()
    expect(alertsFor('أكّد حذف مساحته')).toHaveLength(1)
    expect(alertsFor('أكّد حذف مساحته')[0]).toContain('[قد يتطلب إجراء]')
    expect(alertsFor('أكّد حذف مساحته')[0]).toContain('الحذف مجدول في')
    expect(alertsFor('أكّد حذف مساحته')[0]).toContain('ولم يُحذف شيء بعد')
    expect(alertsFor('أكّد حذف مساحته')[0]).toContain(`/customers/${f.customer}`)
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'customer', reason: null })
    await run(); await run()
    expect(alertsFor('سُحب طلب حذف')).toHaveLength(1)
    // Due: asked, confirmed again, window over.
    await age(f, 120_000)
    await ask(f)
    await send()
    await confirm(f, codeOf(mailsTo(f).at(-1)!.text))
    await dueIn(f, -1)
    await markDueDeletions(pool)
    await run(); await run()
    const dueAlerts = alertsFor('انتهت مهلة حذف')
    expect(dueAlerts).toHaveLength(1)
    expect(dueAlerts[0]).toContain('[يتطلب إجراء]')
  })

  it('shows the vendor every request, lets only a reader see it, and never lets the vendor create, confirm or shorten one', async () => {
    const f = await paidCustomer()
    await confirmed(f)
    const detail = await vendorCall('GET', `/customers/${f.customer}/deletion`, undefined, { capabilities: ['vendor.read'] })
    expect(detail).toMatchObject({ status: 200, data: { deletion: { state: 'confirmed', customer_id: f.customer, renewal_outcome: 'cancelled', requested_by: '7' } } })
    const list = await vendorCall('GET', '/deletion-requests?state=confirmed', undefined, { capabilities: ['vendor.read'] })
    expect(list!.data.items.map((i: any) => i.customer_id)).toContain(f.customer)
    expect(await vendorCall('GET', '/deletion-requests?state=weird', undefined, { capabilities: ['vendor.read'] })).toMatchObject({ status: 422 })
    expect(await vendorCall('GET', `/customers/${f.customer}/deletion`, undefined, { capabilities: [] })).toMatchObject({ status: 403 })
    expect(await vendorCall('GET', `/customers/${randomUUID()}/deletion`)).toMatchObject({ status: 404 })
    // The capability is checked before the customer is looked up: a role without it gets 403 for any id, existing or not.
    for (const id of [f.customer, randomUUID(), 'not-a-uuid']) {
      expect(await vendorCall('GET', `/customers/${id}/deletion`, undefined, { capabilities: [] })).toMatchObject({ status: 403 })
      expect(await vendorCall('POST', `/customers/${id}/deletion/withdraw`, { reason: 'Test case' }, { capabilities: ['vendor.read'] })).toMatchObject({ status: 403 })
    }
    expect(await vendorCall('GET', '/customers/not-a-uuid/deletion')).toMatchObject({ status: 404 })
    // No vendor route creates, confirms or changes the window.
    for (const [method, path] of [['POST', `/customers/${f.customer}/deletion`], ['POST', `/customers/${f.customer}/deletion/request`], ['POST', `/customers/${f.customer}/deletion/confirm`],
      ['PATCH', `/customers/${f.customer}/deletion`], ['PUT', `/customers/${f.customer}/deletion`], ['DELETE', `/customers/${f.customer}/deletion`], ['POST', '/deletion-requests']] as const)
      expect(await vendorCall(method, path, {})).toBeNull()
    expect(await vendorCall('POST', `/customers/${f.customer}/deletion/withdraw`, { reason: 'Test', days: 1 })).toMatchObject({ status: 422 })
  })

  it('serves the four customer routes to the administrator only, rejects a body that names a customer, and keeps customers apart', async () => {
    const a = await paidCustomer('Route A'), b = await paidCustomer('Route B')
    const path = (step: string) => `/v1/customer/deletion${step ? `/${step}` : ''}`
    expect(await route(a, 'GET', path(''))).toMatchObject({ status: 200, data: { deletion: null } })
    // A subscription manager who is not the administrator may not ask, confirm or withdraw; a reader may only look.
    for (const step of ['request', 'confirm', 'withdraw'])
      expect(await route(a, 'POST', path(step), step === 'confirm' ? { code: '123456', company_name: 'x' } : {}, ['subscription.read', 'subscription.manage'])).toMatchObject({ status: 403 })
    expect(await route(a, 'GET', path(''), undefined, ['subscription.read'])).toMatchObject({ status: 200 })
    expect(await route(a, 'GET', path(''), undefined, ['billing.read'])).toMatchObject({ status: 403 })
    // Strict bodies: no address to mail the code to, no customer, no days.
    expect(await route(a, 'POST', path('request'), { email: 'attacker@example.test' })).toMatchObject({ status: 422 })
    expect(await route(a, 'POST', path('request'), { customer_id: b.customer })).toMatchObject({ status: 400 })
    expect(await route(a, 'POST', path('confirm'), { code: '12345', company_name: 'x' })).toMatchObject({ status: 422 })
    expect(await route(a, 'POST', path('confirm'), { code: '123456', company_name: 'x', days: 1 })).toMatchObject({ status: 422 })
    expect(await route(a, 'PATCH', path(''), {})).toMatchObject({ status: 404 })
    // The full flow over the signed routes, with the client address recorded.
    mails.length = 0
    expect(await route(a, 'POST', path('request'), {})).toMatchObject({ status: 200, data: { deletion: { state: 'requested' } } })
    await send()
    expect(mailsTo(a)).toHaveLength(1)
    expect(mailsTo(b)).toHaveLength(0)
    const confirmedView = await route(a, 'POST', path('confirm'), { code: codeOf(mailsTo(a)[0]!.text), company_name: a.name })
    expect(confirmedView).toMatchObject({ status: 200, data: { deletion: { state: 'confirmed' } } })
    expect((await audits(a.customer, 'tenant_deletion.requested'))[0]!.metadata.client_address).toBe('203.0.113.9')
    // The address is signed with the request: one swapped or malformed in transit is refused.
    expect(await route(a, 'GET', path(''), undefined, undefined, '203.0.113.9', '198.51.100.99')).toMatchObject({ status: 401 })
    expect(await route(a, 'GET', path(''), undefined, undefined, '203.0.113.9', 'not-an-address')).toMatchObject({ status: 401 })
    // Customer B sees nothing of A's request and cannot withdraw it.
    expect(await route(b, 'GET', path(''))).toMatchObject({ status: 200, data: { deletion: null } })
    expect(await route(b, 'POST', path('withdraw'), {})).toMatchObject({ status: 200, data: { deletion: null } })
    expect((await row(a.customer)).state).toBe('confirmed')
    expect(await route(a, 'POST', path('withdraw'), { reason: 'Changed my mind' })).toMatchObject({ status: 200, data: { deletion: null } })
    expect((await row(a.customer)).withdraw_reason).toBe('Changed my mind')
  })

  it('refuses a customer with no workspace or no address on record', async () => {
    const noTenant = randomUUID(), noAddress = randomUUID(), tenant = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_login) VALUES($1,$2,$3)', [noTenant, 'No workspace', `${noTenant}@example.test`])
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [noAddress, 'No address', tenant])
    const refuse = (customer: string) => refused(requestDeletion(pool, { ...who, customer_id: customer, secret }))
    expect(await refuse(noTenant)).toEqual({ code: 'no_workspace', status: 409 })
    expect(await refuse(noAddress)).toEqual({ code: 'no_manager_address', status: 409 })
    expect(await refuse(randomUUID())).toEqual({ code: 'not_found', status: 404 })
  })

  it('keeps the state names open for the later drop stages', async () => {
    const check = (await pool.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='tenant_deletion_requests_state_check'")).rows[0]
    expect(check.def).toContain("'requested'")
    expect(check.def).toContain("'due'")
    expect((await pool.query("SELECT 1 FROM schema_migrations WHERE version=57")).rowCount).toBe(1)
  })
})
