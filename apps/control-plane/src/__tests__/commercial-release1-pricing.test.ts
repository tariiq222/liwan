import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { url, client, money, monthly } from './commercial-helpers.js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { migrate } from '../db.js'
import { acceptQuote } from '../commercial/orders.js'
import { planIssues } from '../commercial/plans.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { generateRenewals, applyDunning } from '../commercial/renewals.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { routesB } from '../commercial/routes-b.js'

/**
 * Owner decision 2026-11-06 (release 1, package P1).
 * Prices live on seeded revisions (schema_033 moves the schema_025 placeholders to these amounts); the code
 * never invents one. Amounts are SAR minor units.
 */
export const RELEASE1 = {
  base_monthly: 0,
  crm_monthly: 9900,
  inbox_monthly: 25000,
  extra_user_monthly: 2900,
  storage_per_10gb_monthly: 1000,
  onboarding_onboarding: 49900,
  included_users: 3,
  included_storage_mb: 20480,
  included_branches: 1,
  max_users: 100,
} as const
/** Every plan must carry the AI limits the release declares (owner decision 2026-11-06): a plan that omits one does not compile. */
const AI_LIMITS = { 'ai.messages.monthly': 500, 'ai.tokens.monthly': 2500000, 'ai.assist.monthly': 100, 'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 }
const YEAR = { unit: 'year' as const, count: 1 }
const annualOf = (minor: number) => minor * 10

const suite = url ? describe : describe.skip
suite('release 1 pricing seeds', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'

  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })

  /** The one plan the release sells (schema_025 seeds it; the plan family id is stable across releases). */
  const seedPlan = async () => (await pool.query("SELECT * FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published' AND available ORDER BY version DESC LIMIT 1")).rows[0]

  it('seeds the release 1 base price, included quantities and the 100-user cap', async () => {
    const plan = await seedPlan()
    expect(plan, 'the LiwanOS plan must be seeded and sellable').toBeTruthy()
    expect(plan.prices).toEqual([
      { cadence: monthly, amount: money(RELEASE1.base_monthly) },
      { cadence: YEAR, amount: money(annualOf(RELEASE1.base_monthly)) },
    ])
    expect(plan.included_users).toBe(RELEASE1.included_users)
    // A10 (owner decision 2026-11-07): the free base includes 20 GB, not the original 5 GB.
    expect(plan.included_storage_mb).toBe(20480)
    expect(plan.included_storage_mb / 1024).toBe(20)
    expect(plan.included_extra_branches).toBe(RELEASE1.included_branches)
  })

  it('prices the extra user at 29 a month and 290 a year', async () => {
    const plan = await seedPlan()
    expect(plan.user_prices).toEqual([
      { cadence: monthly, amount: money(RELEASE1.extra_user_monthly) },
      { cadence: YEAR, amount: money(annualOf(RELEASE1.extra_user_monthly)) },
    ])
  })

  it('prices storage at 10 per 10 GB a month: the same 1 per GB the seed already carried', async () => {
    const plan = await seedPlan()
    // The quote engine charges per whole gigabyte (paidStorageGb), so the stored unit price is per 1024 MiB.
    expect(plan.storage_prices).toEqual([
      { cadence: monthly, amount: money(RELEASE1.storage_per_10gb_monthly / 10) },
      { cadence: YEAR, amount: money(annualOf(RELEASE1.storage_per_10gb_monthly / 10)) },
    ])
  })

  it('prices CRM at 99 and customer messages at 250 a month, each annual price ten times the monthly', async () => {
    // Bundle prices live on published revisions, which a fresh control database creates from the release
    // composition (default-bundles) using the per-application seed amounts.
    const version = `commercial-${randomUUID()}`
    const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
    const created = await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Release 1 prices' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const release = created.body
    expect(release.applications.filter((app: any) => app.sellable).map((app: any) => app.id)).toEqual(['crm', 'inbox'])
    const seeded = await api('POST', `/catalog/releases/${release.id}/default-bundles`, { reason: 'Release 1 prices' })
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200)
    const bundles = (await pool.query('SELECT selections,prices FROM bundle_revisions WHERE id = ANY($1::uuid[])', [seeded.body.bundles])).rows
    const priceOf = (app: string) => bundles.find((b: any) => b.selections.some((s: any) => s.app_id === app))?.prices
    expect(priceOf('crm')).toEqual([
      { cadence: monthly, amount: money(RELEASE1.crm_monthly) },
      { cadence: YEAR, amount: money(annualOf(RELEASE1.crm_monthly)) },
    ])
    expect(priceOf('inbox')).toEqual([
      { cadence: monthly, amount: money(RELEASE1.inbox_monthly) },
      { cadence: YEAR, amount: money(annualOf(RELEASE1.inbox_monthly)) },
    ])
  })

  it('offers only monthly and annual cadences, and every annual price is ten times the monthly one', async () => {
    // The seeded LiwanOS plan is the release's own price list; per-application bundle prices are covered above.
    const rows = (await pool.query("SELECT prices FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published' AND available")).rows
    expect(rows).toHaveLength(1)
    for (const { prices } of rows) {
      expect(prices.every((p: any) => p.cadence.unit === 'month' || p.cadence.unit === 'year')).toBe(true)
      expect(prices.filter((p: any) => p.cadence.unit === 'month' && p.cadence.count === 1)).toHaveLength(1)
      for (const monthlyPrice of prices.filter((p: any) => p.cadence.unit === 'month' && p.cadence.count === 1)) {
        const annual = prices.find((p: any) => p.cadence.unit === 'year' && p.cadence.count === 1)
        expect(annual, 'every priced item offers an annual price').toBeTruthy()
        expect(annual.amount.minor).toBe(monthlyPrice.amount.minor * 10)
      }
    }
  })

  it('carries the five AI limits the AI addon registers and no stale ai.setup.monthly', async () => {
    // The seeded revision of the LiwanOS family: a later default-bundles revision is a different, newer draft of it.
    const plan = (await pool.query("SELECT platform_limits FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1' ORDER BY version LIMIT 1")).rows[0]
    expect(plan.platform_limits).toEqual({
      'ai.messages.monthly': 500,
      'ai.tokens.monthly': 2500000,
      'ai.assist.monthly': 100,
      'ai.tool_calls.per_run': 8,
      'ai.output_tokens.per_run': 2000,
    })
  })
})

suite('the 100-user cap', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage'] }
  let plan: any
  const request = (users: number) => ({ kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
    requested_extra_branches: 0, requested_users: users, requested_storage_mb: 0 })

  beforeAll(async () => {
    await migrate(pool)
    const draft = await api('POST', '/plans', { name: `Cap ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Cap acceptance' })
    plan = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Cap acceptance' })).body
  })
  afterAll(async () => { await pool.end() })
  // A paid first order needs a manager to invite (A4), so every fixture customer carries one.
  const customer = async () => { const id = randomUUID(); await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [id, 'Cap customer', 'Manager', 'cap@example.test']); return id }

  it('admits exactly 100 users and refuses 101 with a structured error', async () => {
    const id = await customer()
    const atCap = await createQuoteForCustomer(pool, { customer_id: id, request: request(100) })
    expect(atCap.requested_users).toBe(100)
    await expect(createQuoteForCustomer(pool, { customer_id: id, request: request(101) }))
      .rejects.toMatchObject({ code: 'users_limit_exceeded' })
    // The vendor console's quote route refuses it with the same 422 code, so the console can say "contact us".
    await expect(routesB(pool, { method: 'POST', pathname: '/v1/commercial/customer-quotes', raw: JSON.stringify({ customer_id: id, ...request(101) }),
      issuer: 'cap-test', actor: 1, capabilities: ['vendor.subscriptions.manage'], stepUpFresh: true }, new URL('http://localhost/v1/commercial/customer-quotes')))
      .rejects.toMatchObject({ status: 422, code: 'users_limit_exceeded' })
  })

  it('never grants an entitlement above 100 users', async () => {
    const id = await customer()
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: request(100) })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const view = await getSubscription(pool, id)
    expect(view.pending_order?.target_revision_id).toBe(order.target_revision_id)
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [order.target_revision_id])).rows[0].snapshot
    expect(snapshot.entitlement.features['users.limit']).toBe(100)
  })
})

suite('a plan whose total is zero', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage'] }
  const now = new Date('2026-11-06T08:00:00Z')
  let free: any
  const request = () => ({ kind: 'new', plan_revision_id: free.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 0 })

  beforeAll(async () => {
    await migrate(pool)
    const draft = await api('POST', '/plans', { name: `Free ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      // B: a plan that costs nothing has no trial; it starts active instead of ending past_due.
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Free acceptance' })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    free = (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'Free acceptance' })).body
  })
  afterAll(async () => { await pool.end() })

  async function freeCustomer() {
    const id = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [id, 'Free customer', 'Manager', 'free@example.test'])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: request() })
    expect(quote.due_now.minor).toBe(0)
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    return { id, order }
  }

  it('activates without payment, issues no invoice and never enters a payment-due state', async () => {
    const { id, order } = await freeCustomer()
    expect(order).toMatchObject({ payment_state: 'not_required', fulfillment_state: 'queued' })
    expect(order.due_now.minor).toBe(0)
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE order_id=$1', [order.id])).rows[0].n).toBe(0)
  })

  it('refuses storage steps that do not tile the range they govern', async () => {
    // A6: a 10 GiB step with a 15 GiB threshold leaves 20 GiB unbuyable while 10 GiB is fine. The misalignment is
    // refused at parse time as a structured 422 — before this it reached the database CHECK and became a 500 (23514).
    const body = (over: Record<string, unknown>) => ({ name: `Steps ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(9900) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true, ...over })
    // Each refusal carries the specific code through the route, not the generic `invalid`, so the console can name it.
    const refused = async (over: Record<string, unknown>) => {
      const answer = await api('POST', '/plans', body(over))
      expect(answer.status, JSON.stringify(answer.body)).toBe(422)
      return answer.body
    }
    // A threshold that is not a whole number of small steps.
    expect(await refused({ storage_step_threshold_mb: 15360 })).toMatchObject({ code: 'storage_step_misaligned', field: 'storage_step_threshold_mb', issues: [{ code: 'storage_step_misaligned', field: 'storage_step_threshold_mb' }] })
    // A threshold that is not a whole number of large steps: the engine would offer it and then refuse it.
    expect(await refused({ storage_step_threshold_mb: 153600 })).toMatchObject({ code: 'storage_step_misaligned', field: 'storage_step_threshold_mb' })
    // A large step below the small one.
    expect(await refused({ storage_large_step_mb: 5120 })).toMatchObject({ code: 'storage_step_misaligned', field: 'storage_step_threshold_mb' })
    // The aligned plan is accepted.
    const ok = await api('POST', '/plans', body({}))
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    const okValid = await api('POST', `/plans/${ok.body.id}/validate`, { edit_revision: 1, reason: 'Step acceptance' })
    expect(okValid.status, JSON.stringify(okValid.body)).toBe(200)
    // planIssues still refuses a misaligned row it is handed, which is the path a row from an older database takes.
    // The table itself now rejects such a row (the CHECK mirrors the rule), so the function is exercised directly
    // rather than by planting one: the three callers are plan validate/publish, and they pass a row they did not write.
    const stored = (await pool.query('SELECT * FROM plan_revisions WHERE id=$1', [ok.body.id])).rows[0]
    const issues = await planIssues(pool, { ...stored, storage_step_threshold_mb: 15360 })
    expect(issues.map(i => i.code)).toContain('storage_step_misaligned')
    expect(issues.find(i => i.code === 'storage_step_misaligned')!.field).toBe('storage_step_threshold_mb')
    // And the rule itself is one function, so the row the database accepted is the row planIssues accepts.
    expect(await planIssues(pool, stored)).not.toContainEqual(expect.objectContaining({ code: 'storage_step_misaligned' }))
  })

  it('bounds the storage steps to the integer column, not MAX_SAFE_INTEGER', async () => {
    // A6: the columns are `integer`; a larger value used to reach Postgres and answer 500 (22003 numeric out of range).
    const body = { name: `Step bound ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(9900) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true }
    const tooLarge = await api('POST', '/plans', { ...body, storage_step_threshold_mb: Number.MAX_SAFE_INTEGER })
    expect(tooLarge.status).toBe(422)
    expect(tooLarge.body).toMatchObject({ code: 'storage_step_invalid', field: 'storage_step_threshold_mb' })
    // A zero step is the same kind of refusal, on the field that holds it.
    expect(await api('POST', '/plans', { ...body, storage_step_mb: 0 })).toMatchObject({ status: 422, body: { code: 'storage_step_invalid', field: 'storage_step_mb' } })
    // A field outside the storage steps keeps the generic code: only the rules that have their own code are named.
    expect(await api('POST', '/plans', { ...body, name: '' })).toMatchObject({ status: 422, body: { code: 'invalid', field: 'name' } })
  })

  it('names the storage-step refusal on an edit too, not only on create', async () => {
    const body = { name: `Step edit ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(9900) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true }
    const draft = await api('POST', '/plans', body)
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const edited = await api('PATCH', `/plans/${draft.body.id}`, { ...body, storage_step_threshold_mb: 15360, edit_revision: 1, reason: 'Misaligned edit' })
    expect(edited).toMatchObject({ status: 422, body: { code: 'storage_step_misaligned', field: 'storage_step_threshold_mb' } })
  })

  it('refuses a trial on a plan that costs nothing', async () => {
    // B: a free plan with a trial could only end in past_due, whose Odoo expiry makes a free tenant read-only.
    const draft = await api('POST', '/plans', { name: `Free trial ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: AI_LIMITS, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002', trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'Free trial acceptance' })
    expect(validated.status).toBe(422)
    expect(validated.body.issues.map((i: { code: string }) => i.code)).toContain('trial_on_free_plan')
  })

  it('renews with no invoice and never becomes past_due or suspended', async () => {
    const { id, order } = await freeCustomer()
    // Apply the first order as the worker would, so the subscription has an applied revision and a renewal date.
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-11-01',revision=revision+1 WHERE customer_id=$1", [id])
    const adapter = new SimulatorAdapter()
    const subscriptionId = (await pool.query('SELECT id FROM subscriptions WHERE customer_id=$1', [id])).rows[0].id
    const generated = await generateRenewals(pool, { now, adapter, returnOrigin: fixedReturnOrigin('https://liwan.test'), subscription_id: subscriptionId })
    expect(generated).toHaveLength(1)
    expect(generated[0]!.payment_state).toBe('not_required')
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE subscription_id=$1', [subscriptionId])).rows[0].n).toBe(0)
    const dunning = await applyDunning(pool, { now: new Date('2027-01-01T08:00:00Z') })
    expect(dunning.find((row: any) => row.subscription_id === subscriptionId)).toBeUndefined()
    const state = (await pool.query('SELECT state FROM subscriptions WHERE customer_id=$1', [id])).rows[0].state
    expect(['active', 'trialing']).toContain(state)
  })
})
