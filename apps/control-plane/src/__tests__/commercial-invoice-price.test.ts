import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { applyDunning, generateRenewals } from '../commercial/renewals.js'
import { pricingBaseline } from '../commercial/quote-sources.js'
import { createCustomerTerms } from '../commercial/customer-terms.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000002'
const suite = url ? describe : describe.skip

suite('renewal invoices the latest published add-on price', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage'] }
  const reason = 'Invoice the latest add-on price'
  let releaseId: string
  let selectable: { app: string; feature: string }

  beforeAll(async () => {
    const { version } = await setup(pool)
    const released = await api('POST', '/catalog/releases', { catalog_version: version, reason })
    expect(released.status).toBe(201)
    releaseId = released.body.id
    const app = released.body.applications.find((a: any) => a.selectable && a.features.some((f: any) => f.selectable))
    selectable = { app: app.id, feature: app.features.find((f: any) => f.selectable).key }
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  async function publish(kind: 'plans' | 'bundles', body: unknown) {
    const created = await api('POST', `/${kind}`, body)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const validated = await api('POST', `/${kind}/${created.body.id}/validate`, { edit_revision: 1, reason })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    const published = await api('POST', `/${kind}/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    return published.body
  }
  async function raise(bundle: { id: string; edit_revision: number }, price: number) {
    const revised = await api('POST', `/bundles/${bundle.id}/revisions`, { edit_revision: bundle.edit_revision, reason })
    expect(revised.status, JSON.stringify(revised.body)).toBe(201)
    const edited = await api('PATCH', `/bundles/${revised.body.id}`, {
      name: revised.body.name, description: revised.body.description, audience: revised.body.audience,
      catalog_release_id: revised.body.catalog_release_id, selections: revised.body.selections, domain_limits: revised.body.domain_limits,
      prices: [{ cadence: monthly, amount: money(price) }], edit_revision: revised.body.edit_revision, reason,
    })
    expect(edited.status, JSON.stringify(edited.body)).toBe(200)
    const validated = await api('POST', `/bundles/${revised.body.id}/validate`, { edit_revision: edited.body.edit_revision, reason })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    const published = await api('POST', `/bundles/${revised.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    return published.body
  }
  async function offer(price: number) {
    const bundle = await publish('bundles', {
      name: `Add-on ${randomUUID()}`, description: 'Optional add-on', audience: { kind: 'public' }, catalog_release_id: releaseId,
      selections: [{ app_id: selectable.app, feature_keys: [selectable.feature] }], domain_limits: {},
      prices: [{ cadence: monthly, amount: money(price) }],
    })
    const plan = await publish('plans', {
      name: `Invoice price ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: POLICY, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true,
    })
    return { bundle, plan }
  }
  async function subscribe(planId: string, bundleId: string) {
    const customer = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, 'Invoice price', 'Manager', `price-${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: {
      kind: 'new', plan_revision_id: planId, bundle_revision_ids: [bundleId], cadence: monthly,
      requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0,
    }})
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-11-01',revision=revision+1 WHERE id=$1", [order.subscription_id])
    return { customer, id: order.subscription_id as string, invoice: (await pool.query('SELECT id,total_minor FROM invoices WHERE order_id=$1', [order.id])).rows[0] }
  }
  const renew = () => generateRenewals(pool, { now: new Date('2026-11-02T08:00:00Z'), returnOrigin: fixedReturnOrigin('https://liwan.test') })
  const notices = (id: string) => pool.query("SELECT payload FROM commercial_outbox WHERE kind='billing.notice' AND aggregate_id=$1 AND payload->>'type'='price_changed'", [id])
  const linesOf = async (invoiceId: string) => (await pool.query('SELECT key,kind,amount_minor FROM invoice_lines WHERE invoice_id=$1 ORDER BY position', [invoiceId])).rows

  it('puts a raised catalog price on the next renewal only, with one line and one notice', async () => {
    const { bundle, plan } = await offer(5000)
    const sub = await subscribe(plan.id, bundle.id)
    expect(sub.invoice.total_minor).toBe('15000')
    await raise(bundle, 8000)
    expect((await pool.query('SELECT total_minor FROM invoices WHERE id=$1', [sub.invoice.id])).rows[0].total_minor).toBe('15000')
    expect(await linesOf(sub.invoice.id)).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: `price_change:${bundle.bundle_id}` })]))
    const before = (await pool.query("SELECT snapshot->'pricing' AS pricing FROM subscription_revisions WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)", [sub.id])).rows[0].pricing
    await renew()
    const renewal = (await pool.query(`SELECT i.id,i.total_minor,o.quote_id,o.target_revision_id AS order_target,s.applied_revision_id,s.target_revision_id AS subscription_target
      FROM renewals r JOIN invoices i ON i.id=r.invoice_id JOIN orders o ON o.id=r.order_id JOIN subscriptions s ON s.id=r.subscription_id
      WHERE r.subscription_id=$1`, [sub.id])).rows[0]
    expect(renewal.total_minor).toBe('18000')
    expect(renewal.order_target).toBe(renewal.applied_revision_id)
    expect(renewal.subscription_target).toBeNull()
    const renewalLines = await linesOf(renewal.id)
    expect(renewalLines.filter(l => l.key === `price_change:${bundle.bundle_id}`)).toEqual([{ key: `price_change:${bundle.bundle_id}`, kind: 'adjustment', amount_minor: '0' }])
    expect(renewalLines.find(l => l.kind === 'bundle')!.amount_minor).toBe('8000')
    const quote = (await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [renewal.quote_id])).rows[0].payload
    expect(pricingBaseline(quote, { extra_branches: 0, users: 1, storage_mb: 0 }).bundle_minor[bundle.id]).toBe(8000)
    expect((await notices(sub.id)).rows).toHaveLength(1)
    expect((await notices(sub.id)).rows[0].payload.price_change).toMatchObject({ previous: { minor: 5000 }, next: { minor: 8000 } })
    expect((await pool.query('SELECT total_minor FROM invoices WHERE id=$1', [sub.invoice.id])).rows[0].total_minor).toBe('15000')
    expect((await pool.query("SELECT snapshot->'pricing' AS pricing FROM subscription_revisions WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)", [sub.id])).rows[0].pricing).toEqual(before)

    const periodEnd = (await pool.query('SELECT period_end::text AS end FROM renewals WHERE subscription_id=$1', [sub.id])).rows[0].end
    await pool.query('UPDATE subscriptions SET renewal_at=$2,revision=revision+1 WHERE id=$1', [sub.id, periodEnd])
    await generateRenewals(pool, { now: new Date(`${periodEnd}T12:00:00+03:00`), returnOrigin: fixedReturnOrigin('https://liwan.test') })
    expect((await notices(sub.id)).rows).toHaveLength(1)
    const second = (await pool.query(`SELECT i.id FROM renewals r JOIN invoices i ON i.id=r.invoice_id
      WHERE r.subscription_id=$1 AND i.id<>$2`, [sub.id, renewal.id])).rows[0]
    expect(await linesOf(second.id)).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'adjustment' })]))
    expect((await pool.query('SELECT total_minor FROM invoices WHERE id=$1', [second.id])).rows[0].total_minor).toBe('18000')
  })

  it('keeps a terms price and sends no notice when the catalog rises', async () => {
    const { bundle, plan } = await offer(5000)
    const customer = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, 'Agreed price', 'Manager', `agreed-${customer}@example.test`])
    await createCustomerTerms(pool, { customer_id: customer, reason: 'Agreed add-on price', bundle_prices: { [bundle.id]: { cadence: monthly, amount: money(5000) } } }, vendor)
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: {
      kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [bundle.id], cadence: monthly,
      requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0,
    }})
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-11-01',revision=revision+1 WHERE id=$1", [order.subscription_id])
    await raise(bundle, 8000)
    await renew()
    const renewal = (await pool.query('SELECT i.id,i.total_minor FROM renewals r JOIN invoices i ON i.id=r.invoice_id WHERE r.subscription_id=$1', [order.subscription_id])).rows[0]
    expect(renewal.total_minor).toBe('15000')
    expect(await linesOf(renewal.id)).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'adjustment' })]))
    expect((await notices(order.subscription_id)).rows).toEqual([])
  })

  it('duns an issued renewal after a catalog rise on a free plan', async () => {
    const bundle = await publish('bundles', {
      name: `Free-plan add-on ${randomUUID()}`, description: 'Optional add-on', audience: { kind: 'public' }, catalog_release_id: releaseId,
      selections: [{ app_id: selectable.app, feature_keys: [selectable.feature] }], domain_limits: {},
      prices: [{ cadence: monthly, amount: money(0) }],
    })
    const plan = await publish('plans', {
      name: `Free plan ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: POLICY, trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true,
    })
    const sub = await subscribe(plan.id, bundle.id)
    await raise(bundle, 8000)
    await renew()
    const renewal = (await pool.query('SELECT i.id,i.due_at FROM renewals r JOIN invoices i ON i.id=r.invoice_id WHERE r.subscription_id=$1', [sub.id])).rows[0]
    const dunned = await applyDunning(pool, { now: new Date(new Date(renewal.due_at).getTime() + 86_400_000) })
    expect(dunned).toEqual([{ subscription_id: sub.id, state: 'past_due' }])
    expect((await pool.query('SELECT state FROM subscriptions WHERE id=$1', [sub.id])).rows[0].state).toBe('past_due')
  })
})
