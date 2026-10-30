import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'
import { createQuoteForCustomer, getQuote, pricingBaseline } from '../commercial/quotes.js'
import { recordUsage } from '../commercial/usage.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const START = new Date('2026-10-01T09:00:00.000Z')
// The server quote function supports injecting now; avoid global fake timers
// (which would also freeze PG/network timers) and exercise its real loader.
const EFFECTIVE = new Date('2026-10-17T09:00:00.000Z')
if (url) {
  const target = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !/^\/liwan_control_scratch_[a-z0-9]+$/.test(target.pathname)) throw Error('loopback scratch control DB required')
}
describe.skipIf(!url)('commercial server change quote proration', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool)
  const reason = 'Change quote proration fixture'
  let plan: { id: string }, bundle: { id: string }, releaseApps: any[] = []

  async function publish(kind: 'plans' | 'bundles', body: unknown) {
    const created = await api('POST', `/${kind}`, body)
    expect(created.status).toBe(201)
    const validated = await api('POST', `/${kind}/${created.body.id}/validate`, { edit_revision: 1, reason })
    expect(validated.status).toBe(200)
    const published = await api('POST', `/${kind}/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })
    expect(published.status).toBe(200)
    return published.body
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    const released = await api('POST', '/catalog/releases', { catalog_version: version, reason })
    expect(released.status).toBe(201)
    const release = released.body
    releaseApps = release.applications
    const app = release.applications.find((a: any) => a.selectable && a.features.some((f: any) => f.selectable))
    expect(app).toBeDefined()
    bundle = await publish('bundles', {
      name: `Prorated optional ${randomUUID()}`, description: 'Optional SAR 300 monthly bundle', audience: { kind: 'public' }, catalog_release_id: release.id,
      selections: [{ app_id: app.id, feature_keys: [app.features.find((f: any) => f.selectable).key] }], domain_limits: {},
      prices: [{ cadence: monthly, amount: money(30000) }],
    })
    plan = await publish('plans', {
      name: `Proration plan ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 0, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: POLICY, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true,
    })
  })
  afterAll(() => pool.end())

  async function appliedSubscription(withBundle: boolean) {
    const customer = randomUUID(), subscription = randomUUID(), revision = randomUUID()
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Proration','saas','managed',$2,true)", [tenant, `inv-${tenant}`])
    await pool.query("INSERT INTO customers(id,name,tenant_id) VALUES($1,'Proration customer',$2)", [customer, tenant])
    // A fresh observation with the limit gates Odoo reports: removing an application is judged from these.
    const limits = releaseApps.flatMap(a => a.features.filter((f: any) => f.kind === 'limit').map((f: any) => [f.key, a.selectable ? a.features.filter((g: any) => g.kind === 'boolean').map((g: any) => g.key) : []] as const))
    await recordUsage(pool, { tenant_id: tenant, observed_at: new Date(), metrics: Object.fromEntries(limits.map(([k]) => [k, 0])), limit_gates: Object.fromEntries(limits), source: 'proration' })
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: {
      kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: withBundle ? [bundle.id] : [], cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 0,
    } }, START)
    await pool.query('INSERT INTO subscriptions(id,customer_id) VALUES($1,$2)', [subscription, customer])
    // Seed only the applied revision: no payment, physical fulfillment or clock
    // change is needed to test the server's subscription-baseline quote path.
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, subscription, {
      cadence: monthly, period_start: '2026-10-01', period_end: '2026-11-01', quote_id: quote.id,
      included_extra_branches: 0, pricing: pricingBaseline(quote, { extra_branches: 0, users: 3, storage_mb: 0 }),
    }, quote.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=$2,state='active',renewal_at='2026-11-01',revision=revision+1 WHERE id=$1", [subscription, revision])
    return { customer, subscription, revision }
  }
  async function change(fromBundle: boolean, toBundle: boolean) {
    const s = await appliedSubscription(fromBundle)
    const quote = await createQuoteForCustomer(pool, { customer_id: s.customer, request: {
      kind: 'change', subscription_id: s.subscription, expected_subscription_revision: 1, requested_users: 3, requested_storage_mb: 0,
      plan_revision_id: plan.id, bundle_revision_ids: toBundle ? [bundle.id] : [], cadence: monthly, requested_extra_branches: 0,
    } }, EFFECTIVE)
    expect(quote).toMatchObject({ effective_date: '2026-10-17', next_renewal_at: '2026-11-01', subscription_id: s.subscription, expected_subscription_revision: 1 })
    expect(await getQuote(pool, quote.id)).toEqual(quote)
    expect((await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1', [s.subscription])).rows[0].applied_revision_id).toBe(s.revision)
    return quote
  }

  it('charges an added optional bundle for 15/31 days, rounded half-up, plus 15% VAT only on the due amount', async () => {
    const quote = await change(false, true)
    // 30000 * 15 / 31 = 14516.129... -> 14516 halalas;
    // VAT 14516 * 15% = 2177.4 -> 2177, total due 16693.
    expect(quote.lines.filter(l => l.kind === 'bundle' && l.timing === 'now')).toEqual([
      expect.objectContaining({ key: `bundle:${bundle.id}:delta`, source_revision_id: bundle.id, quantity: 1, amount: money(14516), period_start: '2026-10-17', period_end: '2026-11-01' }),
    ])
    expect(quote.lines.find(l => l.key === 'tax:now')).toMatchObject({ timing: 'now', amount: money(2177) })
    expect(quote.due_now).toEqual(money(16693))
    expect(quote.lines.filter(l => l.timing === 'now' && l.kind !== 'tax').reduce((sum, l) => sum + l.amount.minor, 0)).toBe(14516)
  })

  it('removes a bundle only at renewal, with zero due now and no immediate credit', async () => {
    const quote = await change(true, false)
    expect(quote.due_now).toEqual(money(0))
    expect(quote.lines.find(l => l.key === `bundle:${bundle.id}:delta`)).toMatchObject({ timing: 'renewal', amount: money(0), period_start: '2026-11-01', period_end: '2026-12-01' })
    expect(quote.lines.filter(l => l.timing === 'now' && l.kind === 'bundle')).toHaveLength(0)
    expect(quote.lines.find(l => l.key === 'tax:now')).toMatchObject({ amount: money(0) })
    expect(quote.lines.find(l => l.key === 'tax:renewal')).toMatchObject({ amount: money(1500) })
    expect(quote.next_renewal).toEqual(money(11500))
    expect(quote.bundle_revision_ids).toEqual([])
  })

  it('quotes the full target base and bundle at the next renewal, with full-cycle VAT rather than another proration', async () => {
    const quote = await change(false, true)
    expect(quote.lines.find(l => l.key === 'base')).toMatchObject({ timing: 'renewal', amount: money(10000), period_start: '2026-11-01', period_end: '2026-12-01' })
    expect(quote.lines.find(l => l.key === `bundle:${bundle.id}`)).toMatchObject({ timing: 'renewal', amount: money(30000), period_start: '2026-11-01', period_end: '2026-12-01' })
    expect(quote.lines.find(l => l.key === 'tax:renewal')).toMatchObject({ timing: 'renewal', amount: money(6000) })
    expect(quote.next_renewal).toEqual(money(46000))
    expect(quote.bundle_revision_ids).toEqual([bundle.id])
  })
})
