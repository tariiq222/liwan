import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { signServiceRequest } from '@webvue/commercial-contracts/server'
import { createApp } from '../http.js'
import { buildQuote } from '../commercial/quotes.js'
import { client, money, monthly, setup, url } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('customer quote preview without persistence', () => {
  const pool = new Pool({ connectionString: url })
  const api = client(pool)
  const config = { installationId: 'vendor-preview-test', key: 'vendor-test-key-'.repeat(4),
    customerCommercialIssuer: 'customer-preview-test', customerCommercialServiceKey: 'customer-test-key-'.repeat(4),
    inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
  const reason = 'Customer preview acceptance'
  let server: ReturnType<typeof createApp>, origin: string, tenant: string, customer: string, plan: any
  const request = () => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
    requested_extra_branches: 0, requested_users: 10, requested_storage_mb: 10240 })
  async function call(body: unknown, capabilities = ['subscription.read']) {
    const method = 'POST', raw = JSON.stringify(body)
    const principal = { actor_id: '7', kind: 'customer', tenant_id: tenant, capabilities }
    const header = Buffer.from(JSON.stringify(principal)).toString('base64')
    const signed = signServiceRequest({ method, path: '/v1/customer/preview', body: `webvue-principal:${header}\n${raw}`, actor: 7,
      issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
    return fetch(origin + '/v1/customer/preview', { method, headers: { ...signed, 'x-webvue-principal': header, 'content-type': 'application/json' }, body: raw })
  }
  const quoteRows = async () => Number((await pool.query('SELECT count(*)::int AS n FROM commercial_quotes')).rows[0].n)
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason })
    const created = await api('POST', '/plans', { name: `Preview ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 0, user_prices: [{ cadence: monthly, amount: money(2500) }], storage_prices: [{ cadence: monthly, amount: money(500) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 1, reason })
    plan = (await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })).body
    tenant = randomUUID(); customer = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Preview','saas','managed',$2,true)", [tenant, `preview-${tenant}`])
    await pool.query("INSERT INTO customers(id,name,tenant_id) VALUES($1,'Preview customer',$2)", [customer, tenant])
    server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('missing address')
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await pool.end() })
  it('builds a quote without writing a quote row', async () => {
    const before = await quoteRows()
    const quote = await buildQuote(pool, { customer_id: customer, request: request() })
    expect(quote.due_now.minor).toBe(37375)
    expect(quote.requested_users).toBe(10)
    expect(await quoteRows()).toBe(before)
  })
  it('previews a quote without writing a quote row', async () => {
    const before = await quoteRows()
    const response = await call(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ customer_id: customer, requested_users: 10, due_now: { minor: 37375 } })
    expect(await quoteRows()).toBe(before)
  })
  it('refuses to choose another customer from the body', async () => {
    const response = await call({ ...request(), customer_id: randomUUID() })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'forbidden_field', field: 'customer_id' })
  })
})
