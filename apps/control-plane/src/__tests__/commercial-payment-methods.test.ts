import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { CURRENT_CONSENT_TEXT_VERSION, paymentMethodViewSchema } from '@liwan/commercial-contracts'
import { PaymentError } from '../commercial/payment-adapter.js'
import { client, money, monthly, seedPaymentMethod, setup, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { customerHttp } from '../commercial/customer-http.js'
import { routesB } from '../commercial/routes-b.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { defaultPaymentMethod, paymentMethodView, type PaymentMethodRow } from '../commercial/payment-methods.js'

const row: PaymentMethodRow = { id: 'pm', customer_id: 'c', provider: 'moyasar', mode: 'live', provider_token: 'token_secret_value', brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, status: 'active', is_default: true }

describe('paymentMethodView', () => {
  it('shows the display facts and never the provider token', () => {
    const view = paymentMethodView(row)
    expect(paymentMethodViewSchema.parse(view)).toEqual({ id: 'pm', brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, status: 'active', is_default: true })
    expect(JSON.stringify(view)).not.toContain('token_secret_value')
    expect(paymentMethodView(null)).toBeNull()
  })
})

const suite = url ? describe : describe.skip
suite('live PostgreSQL default payment method', () => {
  const pool = new Pool({ connectionString: url, max: 4 }), api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  const config = { installationId: 'pm-vendor', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'pm-customer', customerCommercialServiceKey: 'customer-test-key-'.repeat(4), inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
  let plan: any, planWithoutRenewal: any
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Payment method acceptance' })
    const c = await api('POST', '/plans', { name: `Methods ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null, included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: true })
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason: 'Payment method acceptance' })
    plan = (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason: 'Payment method acceptance' })).body
    const n = await api('POST', '/plans', { ...planBody(`NoRenew ${randomUUID()}`), auto_renew_allowed: false })
    const nv = await api('POST', `/plans/${n.body.id}/validate`, { edit_revision: 1, reason: 'Payment method acceptance' })
    planWithoutRenewal = (await api('POST', `/plans/${n.body.id}/publish`, { edit_revision: nv.body.edit_revision, reason: 'Payment method acceptance' })).body
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE') })
  afterAll(async () => { await pool.end() })

  const planBody = (name: string) => ({ name, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null, included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: true })
  async function customerWithSubscription(p = plan) {
    const customer = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Methods customer', tenant, 'Manager', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: p.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    return { customer, tenant }
  }
  const adapter = new SimulatorAdapter()
  const runtime = { adapter, returnOrigin: fixedReturnOrigin('https://liwan.test') }
  /** The signed customer route, as the web server calls it. */
  async function route(tenant: string, method: string, path: string, body?: unknown, capabilities = ['subscription.manage', 'billing.read']) {
    const raw = body === undefined ? '' : JSON.stringify(body)
    const header = Buffer.from(JSON.stringify({ actor_id: '7', kind: 'customer', tenant_id: tenant, capabilities })).toString('base64')
    const signed = signServiceRequest({ method, path, body: `liwan-principal:${header}\n${raw}`, actor: 7, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
    return await customerHttp(pool, config, { method, path, raw, headers: { ...signed, 'x-liwan-principal': header, 'content-type': 'application/json' } as never }, runtime) as { status: number; data: any }
  }
  const autoRenew = (tenant: string, body: unknown) => route(tenant, 'POST', '/v1/customer/auto-renew', body)
  const CONSENT = { enabled: true, consent_text_version: CURRENT_CONSENT_TEXT_VERSION }
  let scope = ''
  const audits = async (action: string) => (await pool.query('SELECT actor,subject,reason,metadata FROM audit_events WHERE action=$1 AND subject IN (SELECT id::text FROM subscriptions WHERE customer_id=$2) ORDER BY created_at', [action, scope])).rows
  const vendorCaps = ['vendor.subscriptions.manage']
  const vendorRoute = (path: string, body: unknown, stepUpFresh = true) => routesB(pool, { method: 'POST', pathname: `/v1/commercial${path}`, raw: JSON.stringify(body), issuer: 't', actor: 9, capabilities: vendorCaps as never, stepUpFresh },
    new URL('http://localhost/v1/commercial'), runtime as never)

  it('is null without a row, the default active row otherwise, and ignores inactive, removed and non-default rows', async () => {
    const { customer } = await customerWithSubscription()
    expect(await defaultPaymentMethod(pool, customer)).toBeNull()
    await seedPaymentMethod(pool, customer, 'tok_inactive', { status: 'inactive' })
    await seedPaymentMethod(pool, customer, 'tok_removed', { status: 'removed' })
    await seedPaymentMethod(pool, customer, 'tok_second', { is_default: false })
    expect(await defaultPaymentMethod(pool, customer)).toBeNull()
    const id = await seedPaymentMethod(pool, customer, 'tok_default')
    expect(await defaultPaymentMethod(pool, customer)).toMatchObject({ id, provider_token: 'tok_default', last_four: '4242' })
  })

  it('shows the default card in the subscription view without its token, and enables auto-renew only with a usable card, the plan flag and a consent version', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    expect((await getSubscription(pool, customer)).auto_renew.payment_method).toBeNull()
    await expect(autoRenew(tenant, CONSENT)).rejects.toMatchObject({ code: 'token_required', status: 409 })
    const expired = await seedPaymentMethod(pool, customer, 'tok_expired')
    await pool.query('UPDATE payment_methods SET exp_month=1,exp_year=2026 WHERE id=$1', [expired])
    await expect(autoRenew(tenant, CONSENT)).rejects.toMatchObject({ code: 'token_required', status: 409 })
    await pool.query("UPDATE payment_methods SET status='removed',is_default=false,provider_token=NULL,removed_at=now(),removed_by='customer' WHERE id=$1", [expired])
    const id = await seedPaymentMethod(pool, customer, 'tok_visible')
    await expect(autoRenew(tenant, { enabled: true })).rejects.toMatchObject({ code: 'invalid', status: 422 })
    await expect(autoRenew(tenant, { enabled: true, consent: true })).rejects.toMatchObject({ code: 'invalid', status: 422 })
    expect((await autoRenew(tenant, CONSENT)).data.auto_renew).toMatchObject({ enabled: true, payment_method: { id } })
    const view = await getSubscription(pool, customer)
    expect(view.auto_renew.payment_method).toEqual({ id, brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, status: 'active', is_default: true })
    expect(JSON.stringify(view)).not.toContain('tok_visible')
    expect(await audits('auto_renew.enabled')).toEqual([expect.objectContaining({ actor: '7', metadata: { payment_method_id: id, consent_text_version: CURRENT_CONSENT_TEXT_VERSION } })])
    // Asking again changes nothing and writes nothing.
    await autoRenew(tenant, CONSENT)
    expect(await audits('auto_renew.enabled')).toHaveLength(1)
  })

  it('refuses a consent text version the server does not know, however the request is formed, and writes nothing', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    await seedPaymentMethod(pool, customer, 'tok_unknown_version')
    for (const version of ['v1', '2026-01-01', 'x'.repeat(64)])
      await expect(autoRenew(tenant, { enabled: true, consent_text_version: version })).rejects.toMatchObject({ code: 'consent_version_unknown', status: 422 })
    expect((await getSubscription(pool, customer)).auto_renew.enabled).toBe(false)
    expect(await audits('auto_renew.enabled')).toEqual([])
    expect((await autoRenew(tenant, CONSENT)).data.auto_renew.enabled).toBe(true)
  })

  it('refuses to enable auto-renew when the plan does not allow it, and switches it off without a card', async () => {
    const blocked = await customerWithSubscription(planWithoutRenewal)
    await seedPaymentMethod(pool, blocked.customer, 'tok_plan')
    await expect(autoRenew(blocked.tenant, CONSENT)).rejects.toMatchObject({ code: 'auto_renew_not_allowed', status: 409 })
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    await seedPaymentMethod(pool, customer, 'tok_plan_ok')
    await autoRenew(tenant, CONSENT)
    await pool.query("UPDATE payment_methods SET status='inactive' WHERE customer_id=$1", [customer])
    const off = await autoRenew(tenant, { enabled: false })
    expect(off.data.auto_renew.enabled).toBe(false)
    expect(await audits('auto_renew.disabled')).toEqual([expect.objectContaining({ actor: '7', reason: 'The customer turned automatic renewal off' })])
    await autoRenew(tenant, { enabled: false })
    expect(await audits('auto_renew.disabled')).toHaveLength(1)
  })

  it('lists the customer saved cards masked, and only to a reader of billing', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    await seedPaymentMethod(pool, customer, 'tok_removed_list', { status: 'removed' })
    const old = await seedPaymentMethod(pool, customer, 'tok_old_list', { status: 'inactive', is_default: false })
    const current = await seedPaymentMethod(pool, customer, 'tok_current_list')
    const listed = await route(tenant, 'GET', '/v1/customer/payment-methods')
    expect(listed.data).toEqual({ total: 2, items: [expect.objectContaining({ id: current, is_default: true }), expect.objectContaining({ id: old, status: 'inactive' })] })
    expect(JSON.stringify(listed.data)).not.toMatch(/tok_|provider_token/)
    await expect(route(tenant, 'GET', '/v1/customer/payment-methods', undefined, ['subscription.read'])).rejects.toMatchObject({ status: 403 })
  })

  it('removes a card only after the provider deleted its token, switches auto-renew off for the default card, and is idempotent', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    const id = await seedPaymentMethod(pool, customer, 'tok_remove')
    adapter.addToken('tok_remove')
    await autoRenew(tenant, CONSENT)
    const revisionBefore = (await getSubscription(pool, customer)).revision
    // The provider cannot be reached: the card stays active and chargeable, and the route says so.
    const del = vi.spyOn(adapter, 'deleteToken').mockRejectedValueOnce(new PaymentError('provider_unreachable', 'down'))
    await expect(route(tenant, 'POST', `/v1/customer/payment-methods/${id}/remove`, {})).rejects.toMatchObject({ code: 'provider_unavailable', status: 503 })
    expect((await pool.query('SELECT status,is_default,provider_token FROM payment_methods WHERE id=$1', [id])).rows[0]).toEqual({ status: 'active', is_default: true, provider_token: 'tok_remove' })
    expect((await getSubscription(pool, customer)).auto_renew.enabled).toBe(true)
    expect(await audits('payment_method.removed')).toEqual([])
    const done = await route(tenant, 'POST', `/v1/customer/payment-methods/${id}/remove`, { reason: 'Changing bank' })
    expect(done.data.auto_renew).toMatchObject({ enabled: false, payment_method: null })
    expect(done.data.revision).toBeGreaterThan(revisionBefore)
    expect(del).toHaveBeenCalledWith('tok_remove')
    expect((await pool.query('SELECT status,is_default,provider_token,removed_by FROM payment_methods WHERE id=$1', [id])).rows[0]).toEqual({ status: 'removed', is_default: false, provider_token: null, removed_by: 'customer' })
    expect(await audits('payment_method.removed')).toEqual([expect.objectContaining({ actor: '7', reason: 'Changing bank', metadata: expect.objectContaining({ payment_method_id: id, by: 'customer', last_four: '4242' }) })])
    expect(JSON.stringify(await audits('payment_method.removed'))).not.toContain('tok_remove')
    expect(await audits('auto_renew.disabled')).toHaveLength(1)
    await route(tenant, 'POST', `/v1/customer/payment-methods/${id}/remove`, {})
    expect(await audits('payment_method.removed')).toHaveLength(1)
    // Another customer's card, an unknown id and a read-only caller.
    const other = await customerWithSubscription()
    await expect(route(other.tenant, 'POST', `/v1/customer/payment-methods/${id}/remove`, {})).rejects.toMatchObject({ status: 404 })
    await expect(route(tenant, 'POST', `/v1/customer/payment-methods/${randomUUID()}/remove`, {})).rejects.toMatchObject({ status: 404 })
    await expect(route(tenant, 'POST', `/v1/customer/payment-methods/${id}/remove`, {}, ['billing.read'])).rejects.toMatchObject({ status: 403 })
  })

  it('removing a stale inactive row still flagged default leaves auto-renew on while a newer active default exists', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    const stale = await seedPaymentMethod(pool, customer, 'tok_stale', { status: 'inactive' })
    adapter.addToken('tok_stale')
    await seedPaymentMethod(pool, customer, 'tok_active_default')
    await autoRenew(tenant, CONSENT)
    const done = await route(tenant, 'POST', `/v1/customer/payment-methods/${stale}/remove`, {})
    expect(done.data.auto_renew.enabled).toBe(true)
    expect(await audits('auto_renew.disabled')).toEqual([])
  })

  it('removes a card of another provider or mode locally, without a provider call, and queues its token for deletion where that provider is configured', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    const foreign = await seedPaymentMethod(pool, customer, 'tok_foreign', { provider: 'moyasar', mode: 'live' })
    const del = vi.spyOn(adapter, 'deleteToken'); del.mockClear()
    const done = await route(tenant, 'POST', `/v1/customer/payment-methods/${foreign}/remove`, { reason: 'Old provider' })
    expect(done.data.auto_renew.payment_method).toBeNull()
    expect(del).not.toHaveBeenCalled()
    expect((await pool.query('SELECT status,is_default FROM payment_methods WHERE id=$1', [foreign])).rows[0]).toEqual({ status: 'removed', is_default: false })
    expect(await audits('payment_method.removed')).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ provider_deleted: false }) })])
    const queued = (await pool.query("SELECT payload FROM commercial_outbox WHERE kind='payment_token.delete' AND aggregate_id=$1", [foreign])).rows
    expect(queued).toHaveLength(1)
    expect(queued[0].payload).toMatchObject({ provider: 'moyasar', mode: 'live', token: 'tok_foreign' })
    expect(JSON.stringify(await audits('payment_method.removed'))).not.toContain('tok_foreign')
  })

  it('removing a card that is not the default leaves auto-renew on', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    const old = await seedPaymentMethod(pool, customer, 'tok_old_remove', { status: 'inactive', is_default: false })
    adapter.addToken('tok_old_remove')
    await seedPaymentMethod(pool, customer, 'tok_new_remove')
    await autoRenew(tenant, CONSENT)
    const done = await route(tenant, 'POST', `/v1/customer/payment-methods/${old}/remove`, {})
    expect(done.data.auto_renew.enabled).toBe(true)
    expect(await audits('auto_renew.disabled')).toEqual([])
  })

  it('lets the vendor remove a card or turn auto-renew off for a customer, with a reason and a fresh step-up', async () => {
    const { customer, tenant } = await customerWithSubscription(); scope = customer
    const subscription = (await getSubscription(pool, customer)).id
    const id = await seedPaymentMethod(pool, customer, 'tok_vendor')
    adapter.addToken('tok_vendor')
    await autoRenew(tenant, CONSENT)
    await expect(vendorRoute(`/subscriptions/${subscription}/disable-auto-renew`, { reason: 'x' })).rejects.toMatchObject({ status: 422 })
    await expect(vendorRoute(`/subscriptions/${subscription}/disable-auto-renew`, { reason: 'Customer asked by phone' }, false)).rejects.toMatchObject({ code: 'step_up_required' })
    const off = await vendorRoute(`/subscriptions/${subscription}/disable-auto-renew`, { reason: 'Customer asked by phone' })
    expect((off as any).data.auto_renew.enabled).toBe(false)
    expect(await audits('auto_renew.disabled')).toEqual([expect.objectContaining({ actor: 'account:9', reason: 'Customer asked by phone' })])
    await expect(vendorRoute(`/subscriptions/${subscription}/payment-methods/${id}/remove`, { reason: 'Card reported stolen' }, false)).rejects.toMatchObject({ code: 'step_up_required' })
    const removed = await vendorRoute(`/subscriptions/${subscription}/payment-methods/${id}/remove`, { reason: 'Card reported stolen' })
    expect((removed as any).data.auto_renew.payment_method).toBeNull()
    expect((await pool.query('SELECT status,removed_by FROM payment_methods WHERE id=$1', [id])).rows[0]).toEqual({ status: 'removed', removed_by: 'vendor' })
    expect(await audits('payment_method.removed')).toEqual([expect.objectContaining({ actor: 'account:9', reason: 'Card reported stolen' })])
    await expect(vendorRoute(`/subscriptions/${randomUUID()}/payment-methods/${id}/remove`, { reason: 'Card reported stolen' })).rejects.toMatchObject({ status: 404 })
  })

  it('allows one default active row per customer and one row per provider token', async () => {
    const { customer } = await customerWithSubscription()
    await seedPaymentMethod(pool, customer, 'tok_one')
    await expect(seedPaymentMethod(pool, customer, 'tok_two')).rejects.toMatchObject({ constraint: 'payment_methods_one_default' })
    await expect(seedPaymentMethod(pool, customer, 'tok_one', { is_default: false })).rejects.toMatchObject({ constraint: 'payment_methods_token_unique' })
    await seedPaymentMethod(pool, customer, 'tok_old', { status: 'inactive' })
  })
})
