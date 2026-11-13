import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { paymentMethodViewSchema } from '@liwan/commercial-contracts'
import { client, money, monthly, seedPaymentMethod, setup, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { customerHttp } from '../commercial/customer-http.js'
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
  let plan: any
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Payment method acceptance' })
    const c = await api('POST', '/plans', { name: `Methods ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null, included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: true })
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason: 'Payment method acceptance' })
    plan = (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason: 'Payment method acceptance' })).body
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE') })
  afterAll(async () => { await pool.end() })

  async function customerWithSubscription() {
    const customer = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Methods customer', tenant, 'Manager', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    return { customer, tenant }
  }
  /** The signed customer route, as the web server calls it. */
  async function autoRenew(tenant: string, body: unknown) {
    const method = 'POST', path = '/v1/customer/auto-renew', raw = JSON.stringify(body)
    const header = Buffer.from(JSON.stringify({ actor_id: '7', kind: 'customer', tenant_id: tenant, capabilities: ['subscription.manage'] })).toString('base64')
    const signed = signServiceRequest({ method, path, body: `liwan-principal:${header}\n${raw}`, actor: 7, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
    return await customerHttp(pool, config, { method, path, raw, headers: { ...signed, 'x-liwan-principal': header, 'content-type': 'application/json' } as never }) as { status: number; data: any }
  }

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

  it('shows the default card in the subscription view without its token, and enables auto-renew only with one', async () => {
    const { customer, tenant } = await customerWithSubscription()
    expect((await getSubscription(pool, customer)).auto_renew.payment_method).toBeNull()
    await expect(autoRenew(tenant, { enabled: true, consent: true })).rejects.toMatchObject({ code: 'token_required', status: 409 })
    const id = await seedPaymentMethod(pool, customer, 'tok_visible')
    await expect(autoRenew(tenant, { enabled: true })).rejects.toMatchObject({ code: 'token_required', status: 409 })
    expect((await autoRenew(tenant, { enabled: true, consent: true })).data.auto_renew).toMatchObject({ enabled: true, payment_method: { id } })
    const view = await getSubscription(pool, customer)
    expect(view.auto_renew.payment_method).toEqual({ id, brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, status: 'active', is_default: true })
    expect(JSON.stringify(view)).not.toContain('tok_visible')
  })

  it('allows one default active row per customer and one row per provider token', async () => {
    const { customer } = await customerWithSubscription()
    await seedPaymentMethod(pool, customer, 'tok_one')
    await expect(seedPaymentMethod(pool, customer, 'tok_two')).rejects.toMatchObject({ constraint: 'payment_methods_one_default' })
    await expect(seedPaymentMethod(pool, customer, 'tok_one', { is_default: false })).rejects.toMatchObject({ constraint: 'payment_methods_token_unique' })
    await seedPaymentMethod(pool, customer, 'tok_old', { status: 'inactive' })
  })
})
