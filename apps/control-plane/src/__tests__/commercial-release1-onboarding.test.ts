import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { url, client, money, monthly } from './commercial-helpers.js'
import { migrate } from '../db.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { generateRenewals } from '../commercial/renewals.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { getQuote } from '../commercial/quotes.js'

const suite = url ? describe : describe.skip
const AI_LIMITS = { 'ai.messages.monthly': 500, 'ai.tokens.monthly': 2500000, 'ai.assist.monthly': 100, 'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 }
const POLICY_NO_TAX = '6f1c3d8e-0000-4000-8000-000000000002'
const ONBOARDING = 49900

async function publishRelease1(pool: Pool, api: ReturnType<typeof client>, reason: string) {
  const version = `commercial-${randomUUID()}`
  const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",
    [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
  const created = await api('POST', '/catalog/releases', { catalog_version: version, reason })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  return created.body
}

suite('the one-time onboarding fee (W6)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage', 'vendor.billing.manage'] }
  let plan: any

  beforeAll(async () => {
    await migrate(pool)
    await publishRelease1(pool, api, 'Onboarding acceptance')
    const draft = await api('POST', '/plans', { name: `Onboarding ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(9900) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 5120, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY_NO_TAX, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Onboarding acceptance' })
    plan = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Onboarding acceptance' })).body
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE customers CASCADE')
    await pool.query('TRUNCATE commercial_outbox')
    await pool.query("UPDATE billing_settings SET onboarding_fee_minor=49900 WHERE singleton")
  })
  afterAll(async () => { await pool.end() })

  const request = (onboarding: boolean) => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120, onboarding })

  async function newCustomer() {
    const id = randomUUID()
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [id, 'Onboarding customer', tenant])
    return id
  }

  it('adds one onboarding line at the seeded 499 on a first invoice that asks for it', async () => {
    const id = await newCustomer()
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: request(true) })
    const onboarding = quote.lines.filter(line => line.kind === 'onboarding')
    expect(onboarding).toHaveLength(1)
    expect(onboarding[0]).toMatchObject({ timing: 'now', amount: money(ONBOARDING) })
    expect(quote.due_now.minor).toBe(9900 + ONBOARDING)
    // It is a first-invoice item only: the renewal the quote previews carries none.
    expect(quote.lines.filter(line => line.kind === 'onboarding' && line.timing === 'renewal')).toHaveLength(0)
    expect(quote.next_renewal.minor).toBe(9900)
  })

  it('leaves it out when the purchase does not ask for it', async () => {
    const id = await newCustomer()
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: request(false) })
    expect(quote.lines.some(line => line.kind === 'onboarding')).toBe(false)
    expect(quote.due_now.minor).toBe(9900)
  })

  it('never puts it on a renewal invoice', async () => {
    const id = await newCustomer()
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: request(true) })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const first = (await pool.query("SELECT * FROM invoice_lines WHERE invoice_id=(SELECT id FROM invoices WHERE order_id=$1)", [order.id])).rows
    expect(first.filter((l: any) => l.kind === 'onboarding')).toHaveLength(1)
    // Apply the first order as the worker would, then renew a month later.
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-11-01',revision=revision+1 WHERE customer_id=$1", [id])
    await generateRenewals(pool, { now: new Date('2026-11-06T08:00:00Z'), adapter: new SimulatorAdapter(), returnOrigin: fixedReturnOrigin('https://liwan.test') })
    const renewal = (await pool.query(`SELECT l.kind FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
      JOIN orders o ON o.id=i.order_id WHERE o.kind='renewal' AND o.customer_id=$1`, [id])).rows.map((r: any) => r.kind)
    expect(renewal).not.toContain('onboarding')
  })

  it('refuses a second onboarding for a customer that already bought one', async () => {
    const id = await newCustomer()
    const first = await createQuoteForCustomer(pool, { customer_id: id, request: request(true) })
    await acceptQuote(pool, { quote_id: first.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    // The second quote is a change of the same subscription, which can never carry onboarding again.
    const sub = (await pool.query('SELECT id,revision FROM subscriptions WHERE customer_id=$1', [id])).rows[0]
    expect(sub).toBeTruthy()
    await expect(createQuoteForCustomer(pool, { customer_id: id, request: { ...request(true), kind: 'change', subscription_id: sub.id,
      expected_subscription_revision: sub.revision, bundle_revision_ids: first.bundle_revision_ids } }))
      .rejects.toMatchObject({ code: 'onboarding_first_order_only' })
  })

  it('offers no onboarding line while the vendor has not seeded the fee', async () => {
    await pool.query("UPDATE billing_settings SET onboarding_fee_minor=0 WHERE singleton")
    const id = await newCustomer()
    await expect(createQuoteForCustomer(pool, { customer_id: id, request: request(true) })).rejects.toMatchObject({ code: 'onboarding_unavailable' })
    const without = await createQuoteForCustomer(pool, { customer_id: id, request: request(false) })
    expect(without.due_now.minor).toBe(9900)
  })
})
