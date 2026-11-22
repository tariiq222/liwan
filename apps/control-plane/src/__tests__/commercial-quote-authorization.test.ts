import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'
import { routesB } from '../commercial/routes-b.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { applyReceipt } from '../commercial/fulfillment.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const READ_ONLY = ['vendor.read'] as any[]
const SELL = ['vendor.read', 'vendor.subscriptions.manage'] as any[]
const suite = url ? describe : describe.skip
suite('commercial quote authorization', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool)
  const reason = 'Quote authorization'
  let plan: any
  const planBody = () => ({ name: `Q ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
    prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
    included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null,
    included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
    user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: POLICY,
    trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
  const request = () => ({ kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 })
  const customer = async () => { const id = randomUUID(); await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [id, 'Quote customer', 'Manager', 'quote@example.test']); return id }
  /** A vendor route of the second route file, with the given capabilities and a fresh step-up. */
  const vendorRoute = (caps: any[]) => async (method: string, path: string, body?: unknown) => {
    const target = new URL(`/v1/commercial${path}`, 'http://liwan.test')
    try {
      const r = await routesB(pool, { method, pathname: target.pathname, raw: JSON.stringify(body), actor: 7, issuer: 'quote-auth', capabilities: caps, stepUpFresh: true }, target)
      return { status: r!.status, body: r!.data as any }
    } catch (e) {
      if (e instanceof CommercialHttpError) return { status: e.status, body: { code: e.code } as any }
      throw e
    }
  }
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  const publish = async (body: unknown = planBody()) => {
    const c = await api('POST', '/plans', body)
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason })
    return { id: c.body.id as string, revision: (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason })).body }
  }
  /** A customer whose subscription has `plan` applied, through a free order and its fulfilment receipt. */
  async function appliedCustomer(applied: any) {
    const id = await customer(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Quote tenant','saas','dedicated_managed',$2,true)", [tenant, `quote-${tenant}`])
    await pool.query('UPDATE customers SET tenant_id=$2 WHERE id=$1', [id, tenant])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: { ...request(), plan_revision_id: applied.id } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }, vendor)
    const adapter = new SimulatorAdapter()
    const attempt = await createPaymentAttempt(pool, { order_id: order.id, customer_id: id, adapter, returnOrigin: fixedReturnOrigin('https://liwan.test') })
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', adapter, rawBody: adapter.webhookBody(attempt.provider_ref), headers: {} })
    await pool.query('INSERT INTO fulfillment_effects(id,order_id,operation_id) VALUES($1,$2,$3)', [randomUUID(), order.id, randomUUID()])
    await applyReceipt(pool, { order_id: order.id, receipt: { order_id: order.id, tenant_id: tenant, target_revision_id: order.target_revision_id,
      observed_entitlement_digest: quote.entitlement_digest, observed_at: new Date().toISOString(), branch_bindings: [], root_company_id: 1 } })
    return id
  }
  const stored = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM commercial_quotes WHERE customer_id=$1', [id])).rows[0].n
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason })
    const c = await api('POST', '/plans', planBody())
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason })
    plan = (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason })).body
  })
  afterAll(async () => { await pool.end() })

  it('the read-only preview prices a customer quote without storing one', async () => {
    const id = await customer()
    const preview = await client(pool, READ_ONLY)('POST', '/quotes', { customer_id: id, ...request() })
    expect(preview.status).toBe(201)
    expect(preview.body.customer_id).toBe(id)
    expect(await stored(id)).toBe(0)
    expect((await api('GET', `/quotes/${preview.body.id}`)).status).toBe(404)
  })
  it('a quote stored for a customer needs the subscriptions capability', async () => {
    const id = await customer()
    expect((await vendorRoute(READ_ONLY)('POST', '/customer-quotes', { customer_id: id, ...request() })).status).toBe(403)
    expect(await stored(id)).toBe(0)
    const made = await vendorRoute(SELL)('POST', '/customer-quotes', { customer_id: id, ...request() })
    expect(made.status).toBe(201)
    expect(await stored(id)).toBe(1)
    expect((await api('GET', `/quotes/${made.body.id}`)).status).toBe(200)
  })

  describe('a change to another plan revision', () => {
    const change = (customerId: string, planRevisionId: string) => ({ customer_id: customerId,
      request: { ...request(), kind: 'change', plan_revision_id: planRevisionId } })
    it('is refused for a draft revision', async () => {
      const id = await appliedCustomer(plan)
      const draft = await api('POST', '/plans', planBody())
      await expect(createQuoteForCustomer(pool, change(id, draft.body.id))).rejects.toMatchObject({ status: 422, code: 'not_sellable' })
    })
    it('is refused for a withdrawn revision the subscription never applied', async () => {
      const id = await appliedCustomer(plan)
      const other = await publish()
      await api('POST', `/plans/${other.id}/withdraw`, { edit_revision: other.revision.edit_revision, reason })
      await expect(createQuoteForCustomer(pool, change(id, other.revision.id))).rejects.toMatchObject({ status: 422, code: 'not_sellable' })
    })
    it('stays quotable for the revision the subscription applied after it is withdrawn', async () => {
      const mine = await publish()
      const id = await appliedCustomer(mine.revision)
      await api('POST', `/plans/${mine.id}/withdraw`, { edit_revision: mine.revision.edit_revision, reason })
      const quote = await createQuoteForCustomer(pool, change(id, mine.revision.id))
      expect(quote.plan_revision_id).toBe(mine.revision.id)
    })
    it('is allowed for another published revision', async () => {
      const id = await appliedCustomer(plan)
      const other = await publish()
      expect((await createQuoteForCustomer(pool, change(id, other.revision.id))).plan_revision_id).toBe(other.revision.id)
    })
  })
})
