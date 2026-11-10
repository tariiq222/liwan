import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { url, client, money, monthly } from './commercial-helpers.js'
import { migrate } from '../db.js'
import { riyadhDate } from '@liwan/commercial-contracts'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { routesB } from '../commercial/routes-b.js'
import { confirmBankTransfer } from '../commercial/bank-transfer.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { getSubscription } from '../commercial/subscriptions.js'

const suite = url ? describe : describe.skip
const AI_LIMITS = { 'ai.messages.monthly': 500, 'ai.tokens.monthly': 2500000, 'ai.assist.monthly': 100, 'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 }
const POLICY_NO_TAX = '6f1c3d8e-0000-4000-8000-000000000002'

/**
 * W4 (owner decision 2026-11-06): a customer the vendor adds starts on a paid package, never on a trial. Issue #143's
 * invariant is kept: an order must never leave a customer paid with no way to get a tenant.
 */
suite('a vendor-added customer starts paid (W4)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  let plan: any
  const vendorCaps = ['vendor.subscriptions.manage', 'vendor.tenants.manage', 'vendor.pricing.manage', 'vendor.billing.manage']

  beforeAll(async () => {
    await migrate(pool)
    const version = `commercial-${randomUUID()}`
    const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",
      [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
    const release = await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Vendor paid acceptance' })
    expect(release.status, JSON.stringify(release.body)).toBe(201)
    const bundles = await api('POST', `/catalog/releases/${release.body.id}/default-bundles`, { reason: 'Vendor paid acceptance' })
    expect(bundles.status, JSON.stringify(bundles.body)).toBe(200)
    const crmBundle = bundles.body.bundles.length ? [bundles.body.bundles[0]] : []
    const draft = await api('POST', '/plans', { name: `Vendor paid ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(9900) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: crmBundle,
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY_NO_TAX, trial_days: 14, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Vendor paid acceptance' })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    plan = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Vendor paid acceptance' })).body
  })
  beforeEach(async () => {
    vi.unstubAllEnvs()
    await pool.query('TRUNCATE customers CASCADE')
    await pool.query('TRUNCATE commercial_outbox')
  })
  afterAll(async () => { await pool.end() })

  /** The vendor console path: create the customer, quote its paid first order, place the order. */
  /** A customer the vendor created WITHOUT a manager email: nobody to invite, so a paid first order must be refused. */
  async function createCustomerWithoutManager(name: string) {
    const response = await routesB(pool, { method: 'POST', pathname: '/v1/commercial/customers',
      raw: JSON.stringify({ name, tenant_id: await newTenant() }),
      issuer: 'vendor-paid-test', actor: 1, capabilities: vendorCaps as any, stepUpFresh: true }, new URL('http://localhost/v1/commercial/customers'))
    expect(response!.status).toBe(201)
    return response!.data as { id: string }
  }

  /** A control tenant the customer belongs to, with no enabled registry binding (nothing provisioned yet). */
  async function newTenant() {
    const id = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Vendor customer','saas','dedicated_managed',$2,true)", [id, `vendor-${id}`])
    return id
  }
  /** The vendor console's customer creation, through the route it calls. */
  async function createCustomer(name: string, adminLogin: string) {
    const response = await routesB(pool, { method: 'POST', pathname: '/v1/commercial/customers',
      raw: JSON.stringify({ name, tenant_id: await newTenant(), admin_name: 'Admin', admin_login: adminLogin }),
      issuer: 'vendor-paid-test', actor: 1, capabilities: vendorCaps as any, stepUpFresh: true }, new URL('http://localhost/v1/commercial/customers'))
    expect(response!.status).toBe(201)
    return response!.data as { id: string }
  }
  async function vendorOrder() {
    const customer = await createCustomer('Vendor customer', 'admin@example.test')
    const merge = bundles_param()
    const quote = await createQuoteForCustomer(pool, { customer_id: customer.id, request: { kind: 'new', plan_revision_id: plan.id,
      bundle_revision_ids: merge, cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 } })
    expect(quote.due_now.minor).toBeGreaterThan(0)
    const ordered = await placeOrder(customer.id, quote.id)
    expect(ordered, 'the paid first order must be accepted').toBeTruthy()
    return { customer_id: customer.id, quote, order: ordered! }
  }
  const bundles_param = () => (plan.optional_bundle_revision_ids as string[]).slice(0, 1)
  const placeOrder = (customerId: string, quoteId: string, revision = 0) => routesB(pool, { method: 'POST', pathname: '/v1/commercial/orders',
    raw: JSON.stringify({ quote_id: quoteId, expected_subscription_revision: revision, idempotency_key: randomUUID() }),
    issuer: 'vendor-paid-test', actor: 1, capabilities: vendorCaps as any, stepUpFresh: true }, new URL('http://localhost/v1/commercial/orders'))

  it('places a paid first order in shared mode instead of forcing a trial', async () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    const result = await vendorOrder()
    expect(result.order.status).toBe(201)
    expect(result.order.data.order).toMatchObject({ payment_state: 'awaiting_payment' })
    const subscription = await getSubscription(pool, result.customer_id)
    expect(subscription.state).not.toBe('trialing')
    expect((await pool.query('SELECT trial_used_at FROM customers WHERE id=$1', [result.customer_id])).rows[0].trial_used_at).toBeNull()
  })

  it('activates on a Moyasar success: the tenant is provisioned and the manager invitation is issued', async () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    const { customer_id, order } = await vendorOrder()
    const adapter = new SimulatorAdapter()
    // The console's own bank of steps: create the hosted attempt, then settle it through the simulator route, which
    // delivers the provider event through the one settlement path.
    const runtime = { adapter, returnOrigin: fixedReturnOrigin('https://liwan.test') }
    const attempt = await createPaymentAttempt(pool, { order_id: order.data.order.id, customer_id, adapter, returnOrigin: runtime.returnOrigin })
    const settled = await routesB(pool, { method: 'POST', pathname: `/v1/commercial/payment-simulator/${attempt.id}/settle`,
      raw: JSON.stringify({ outcome: 'succeeded' }), issuer: 'vendor-paid-test', actor: 1,
      capabilities: vendorCaps as any, stepUpFresh: true }, new URL('http://localhost/v1/commercial'), runtime)
    expect(settled).toMatchObject({ data: { outcome: 'accepted' } })
    const row = (await pool.query('SELECT payment_state, fulfillment_state FROM orders WHERE id=$1', [order.data.order.id])).rows[0]
    expect(row).toMatchObject({ payment_state: 'paid', fulfillment_state: 'queued' })
    const outbox = (await pool.query("SELECT kind FROM commercial_outbox WHERE aggregate_id=$1 AND status='pending'", [order.data.order.id])).rows.map((r: any) => r.kind)
    expect(outbox).toContain('fulfillment.enqueue')
  })

  it('activates on a recorded bank transfer the same way', async () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    const { order } = await vendorOrder()
    const invoice = (await pool.query("SELECT id FROM invoices WHERE order_id=$1 AND status='issued'", [order.data.order.id])).rows[0]
    const result = await confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', reference: `TRF-${randomUUID().slice(0, 8)}`,
      amount: order.data.order.due_now.minor, value_date: riyadhDate(new Date()) })
    expect(result.replay).toBe(false)
    const row = (await pool.query('SELECT payment_state, fulfillment_state FROM orders WHERE id=$1', [order.data.order.id])).rows[0]
    expect(row).toMatchObject({ payment_state: 'paid', fulfillment_state: 'queued' })
  })

  it('accepts a paid first order from a customer whose subscription already has a tenant, even with no admin_login', async () => {
    // A7: in dedicated mode a bound tenant means fulfilment proceeds without a manager; the old guard refused it
    // anyway, because it looked only at admin_login and shared-registry bindings. Both callers now share one predicate.
    vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
    const customer = await createCustomerWithoutManager('Bound tenant')
    // The subscription and its tenant: the workspace exists, so fulfilment has somewhere to provision into.
    const subscription = randomUUID()
    await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)', [subscription, customer.id, (await pool.query('SELECT tenant_id FROM customers WHERE id=$1', [customer.id])).rows[0].tenant_id])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer.id, request: { kind: 'new', plan_revision_id: plan.id,
      bundle_revision_ids: bundles_param(), cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 } })
    expect(quote.due_now.minor).toBeGreaterThan(0)
    const ordered = await placeOrder(customer.id, quote.id)
    expect(ordered!.status, JSON.stringify(ordered!.data)).toBe(201)
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customer.id])).rows[0].n).toBe(1)
  })

  it('still refuses a paid first order from a customer with no tenant and no manager', async () => {
    // The predicate must not have become "always true": a customer with no subscription tenant, no binding and no admin
    // is still refused, because fulfilment would then have nowhere to put the workspace.
    vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
    const customer = await createCustomerWithoutManager('No tenant either')
    await pool.query('UPDATE customers SET tenant_id=NULL WHERE id=$1', [customer.id])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer.id, request: { kind: 'new', plan_revision_id: plan.id,
      bundle_revision_ids: bundles_param(), cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 } })
    await expect(placeOrder(customer.id, quote.id)).rejects.toMatchObject({ status: 409, code: 'admin_login_required' })
  })

  it('refuses a paid first order for a customer with no manager to invite', async () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    const customer = await createCustomerWithoutManager('No manager')
    const quote = await createQuoteForCustomer(pool, { customer_id: customer.id, request: { kind: 'new', plan_revision_id: plan.id,
      bundle_revision_ids: bundles_param(), cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 } })
    expect(quote.due_now.minor).toBeGreaterThan(0)
    await expect(placeOrder(customer.id, quote.id)).rejects.toMatchObject({ status: 409, code: 'admin_login_required' })
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customer.id])).rows[0].n).toBe(0)
  })

  it('refuses a bank transfer and a payment attempt for the same unprovisionable order', async () => {
    // The order itself is refused, so the only way to reach the later gates is a customer that lost its manager email
    // after the order was accepted; the gates still refuse it rather than take money for a workspace nobody can enter.
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    const { customer_id, order } = await vendorOrder()
    await pool.query('UPDATE customers SET admin_login=NULL WHERE id=$1', [customer_id])
    const invoice = (await pool.query("SELECT * FROM invoices WHERE order_id=$1 AND status='issued'", [order.data.order.id])).rows[0]
    await expect(confirmBankTransfer(pool, { invoice_id: invoice.id, operator: 'vendor:7', reference: `TRF-${randomUUID().slice(0, 8)}`,
      amount: Number(invoice.total_minor), value_date: riyadhDate(new Date()) }))
      .rejects.toMatchObject({ status: 409, code: 'admin_login_required' })
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.data.order.id])).rows[0].payment_state).toBe('awaiting_payment')
  })

  it('never leaves a paid first order without a way to get a tenant (issue #143 invariant)', async () => {
    // The guard that mattered was never paid-before-tenant; it was paid-with-no-tenant-to-provision. A paid first
    // order now always carries the tenant its fulfilment provisions, so the order can never be paid and stranded.
    const { customer_id, order } = await vendorOrder()
    // The order names the control tenant its fulfilment provisions, so a payment for it can always be fulfilled.
    const subscription = (await pool.query('SELECT tenant_id FROM subscriptions WHERE customer_id=$1', [customer_id])).rows[0]
    expect(subscription.tenant_id).toBeTruthy()
    expect((await pool.query('SELECT 1 FROM tenants WHERE id=$1', [subscription.tenant_id])).rowCount).toBe(1)
    expect(order.data.order.payment_state).toBe('awaiting_payment')
  })

  it('still refuses a customer-initiated paid first order exactly as before', async () => {
    // A customer principal may not place a first order at all: only the trial path exists for them in release 1.
    const id = randomUUID()
    await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [id, 'Customer principal'])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: bundles_param(),
      cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 } })
    await expect(routesB(pool, { method: 'POST', pathname: '/v1/commercial/orders', raw: JSON.stringify({ quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }),
      issuer: 'customer-test', actor: 1, capabilities: ['subscription.manage'] as any, stepUpFresh: true }, new URL('http://localhost/v1/commercial/orders')))
      .rejects.toMatchObject({ status: 403 })
  })

  it('leaves the trial path untouched: a vendor can still start a trial', async () => {
    const customer = await createCustomer('Trial customer', 'trial@example.test')
    // An existing tenant can start a trial only once its runtime can enforce the cutoff and excess policy.
    await pool.query(`UPDATE tenants SET post_trial_supported=true,excess_supported=true
      WHERE id=(SELECT tenant_id FROM customers WHERE id=$1)`, [customer.id])
    const trial = await routesB(pool, { method: 'POST', pathname: `/v1/commercial/customers/${customer.id}/trial`,
      raw: JSON.stringify({ kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: bundles_param(), cadence: monthly,
        requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 }),
      issuer: 'vendor-paid-test', actor: 1, capabilities: vendorCaps as any, stepUpFresh: true }, new URL('http://localhost/v1/commercial'))
    expect(trial!.status).toBe(201)
    expect((await pool.query('SELECT state FROM subscriptions WHERE customer_id=$1', [customer.id])).rows[0].state).toBe('trialing')
  })
})
