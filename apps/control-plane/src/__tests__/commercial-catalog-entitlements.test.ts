import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { url, client, money, monthly } from './commercial-helpers.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { pushCatalogEntitlement } from '../commercial/catalog-entitlements.js'
import { pendingChangeRefusal } from '../commercial/cancellation-rules.js'
import { processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { buildRenewalOn } from '../commercial/renewals.js'
import { recordUsage } from '../commercial/usage.js'
import { migrate, transaction } from '../db.js'

const suite = url ? describe.sequential : describe.skip
const REASON = 'Catalog entitlement follow'
const POLICY_NO_TAX = '6f1c3d8e-0000-4000-8000-000000000002'
const AI_LIMITS = { 'ai.messages.monthly': null, 'ai.tool_calls.per_run': null, 'ai.tokens.monthly': null, 'ai.assist.monthly': 100, 'ai.output_tokens.per_run': null }
const LIMIT = 'projects.max_projects'
const NEW_APP = 'fieldwork.enabled'

suite('catalog entitlement follow', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  let plan: any, bundleId: string, raised: any
  let pushSub: { id: string }

  async function publishResponse(solution: unknown) {
    const version = `commercial-${randomUUID()}`
    const raw = JSON.stringify(solution)
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)",
      [randomUUID(), version, solution, createHash('sha256').update(raw).digest('hex')])
    return api('POST', '/catalog/releases', { catalog_version: version, reason: REASON })
  }
  async function publish(solution: unknown) {
    const created = await publishResponse(solution)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.id, JSON.stringify(created.body)).toBeTruthy()
    return created.body
  }
  async function catalogOrders(id: string) {
    return (await pool.query("SELECT count(*)::int AS n FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE 'catalog-release:%'", [id])).rows[0].n as number
  }
  function catalog(ceiling: number | 'drop' | 'drop-limit', extra = false) {
    const solution = JSON.parse(JSON.stringify(base))
    const projects = solution.tiers.find((t: any) => t.id === 'projects')
    if (ceiling === 'drop') solution.tiers = solution.tiers.filter((t: any) => t.id !== 'projects')
    else if (ceiling === 'drop-limit') projects.features = projects.features.filter((f: string) => !f.startsWith('limit:projects.max_projects'))
    else projects.features = projects.features.map((f: string) => f.startsWith('limit:projects.max_projects') ? `limit:projects.max_projects:${ceiling}` : f)
    if (extra) solution.tiers.push({
      id: 'fieldwork', name: 'Fieldwork', description: 'An application a later release adds', sellable: true,
      modules: ['liwan_fieldwork'], features: ['boolean:fieldwork.enabled', 'limit:fieldwork.max_jobs:0'],
    })
    return solution
  }
  async function snapshotOf(revisionId: string) {
    return (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [revisionId])).rows[0].snapshot
  }
  async function appliedOf(id: string) {
    const row = (await pool.query('SELECT applied_revision_id, target_revision_id FROM subscriptions WHERE id=$1', [id])).rows[0]
    return { ...row, snapshot: await snapshotOf(row.applied_revision_id) }
  }
  async function subscribe(planRevisionId: string) {
    const customer = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Catalog customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Catalog customer', tenant, 'Manager', `catalog-${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: {
      kind: 'new', plan_revision_id: planRevisionId, bundle_revision_ids: [bundleId], cadence: monthly,
      requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0,
    }})
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at=$2,revision=revision+1 WHERE id=$1", [order.subscription_id, quote.next_renewal_at])
    return { id: order.subscription_id as string, quote }
  }
  async function renew(id: string, start: string) {
    return transaction(pool, async client => {
      const sub = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE', [id])).rows[0]
      return buildRenewalOn(client, sub, { now: new Date('2026-12-01T08:00:00Z'), start })
    })
  }
  let base: any
  beforeAll(async () => {
    await migrate(pool)
    base = JSON.parse((await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))).toString())
    const release = await publish(catalog(5))
    const projects = release.applications.find((a: any) => a.id === 'projects')
    const featureKeys = projects.features.filter((f: any) => f.kind === 'boolean' && f.selectable).map((f: any) => f.key)
    const draft = await api('POST', '/bundles', {
      name: 'Projects', description: 'Projects', audience: { kind: 'public' }, catalog_release_id: release.id,
      selections: [{ app_id: 'projects', feature_keys: featureKeys }], domain_limits: {}, prices: [{ cadence: monthly, amount: money(5000) }],
    })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/bundles/${draft.body.id}/validate`, { edit_revision: 1, reason: REASON })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    const published = await api('POST', `/bundles/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: REASON })
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    bundleId = draft.body.id
    const planDraft = await api('POST', '/plans', {
      name: `Catalog follow ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: AI_LIMITS,
      included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundleId],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: POLICY_NO_TAX, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true,
    })
    expect(planDraft.status, JSON.stringify(planDraft.body)).toBe(201)
    const planValid = await api('POST', `/plans/${planDraft.body.id}/validate`, { edit_revision: 1, reason: REASON })
    plan = (await api('POST', `/plans/${planDraft.body.id}/publish`, { edit_revision: planValid.body.edit_revision, reason: REASON })).body
    expect(plan.status).toBe('published')
    pushSub = { id: (await subscribe(plan.id)).id }
  })
  afterAll(async () => { await pool.end() })

  it('returns 201 and creates no order when a republished release leaves the feature map unchanged', async () => {
    const before = await appliedOf(pushSub.id)
    const created = await publishResponse(catalog(5))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.id).toBeTruthy()
    const after = await appliedOf(pushSub.id)
    expect(after.target_revision_id).toBeNull()
    expect(after.snapshot.entitlement.features).toEqual(before.snapshot.entitlement.features)
    expect(await catalogOrders(pushSub.id)).toBe(0)
  })

  it('delivers a raised owned limit after the push, never a new application, and not twice', async () => {
    const before = await appliedOf(pushSub.id)
    expect(before.snapshot.entitlement.features[LIMIT]).toBe(5)
    expect(before.snapshot.entitlement.features[NEW_APP]).toBeUndefined()
    expect(before.target_revision_id).toBeNull()
    // Publishing the release is the push: the route delivers it before the response returns.
    raised = await publish(catalog(20, true))
    const after = await appliedOf(pushSub.id)
    const sub = (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [pushSub.id])).rows[0]
    const follow = (await pool.query("SELECT target_revision_id FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE 'catalog-release:%'", [pushSub.id])).rows[0]
    const delivered = await snapshotOf(follow.target_revision_id)
    expect(after.target_revision_id).toBeNull()
    expect(await pendingChangeRefusal(pool, sub)).toBeNull()
    expect(after.snapshot.entitlement.features[LIMIT]).toBe(5)
    expect(delivered.entitlement.features[LIMIT]).toBe(20)
    expect(delivered.bundle_revision_ids).toEqual(before.snapshot.bundle_revision_ids)
    expect(delivered.entitlement.features[NEW_APP]).toBe(false)
    expect(await catalogOrders(pushSub.id)).toBe(1)
    const tenant = sub.tenant_id as string
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)',
      [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    await processFulfillmentOutbox(pool)
    expect((await pool.query("SELECT count(*)::int AS n FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure' AND payload->'authority'->>'target_revision_id'=$2", [tenant, follow.target_revision_id])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT target_revision_id FROM subscriptions WHERE id=$1', [pushSub.id])).rows[0].target_revision_id).toBeNull()
    const second = await pushCatalogEntitlement(pool, { id: raised.id })
    expect(second.pushed).toBe(0)
    expect(second.failed).toBe(0)
    expect(await catalogOrders(pushSub.id)).toBe(1)
  })

  it('recompiles the renewal entitlement and keeps the pinned price', async () => {
    const bought = await subscribe(plan.id)
    const applied = await appliedOf(bought.id)
    expect(applied.snapshot.entitlement.features[LIMIT]).toBe(5)
    const revised = await api('POST', `/plans/${plan.id}/revisions`, { edit_revision: plan.edit_revision, reason: REASON })
    expect(revised.status, JSON.stringify(revised.body)).toBe(201)
    const src = revised.body
    const edited = await api('PATCH', `/plans/${src.id}`, {
      edit_revision: src.edit_revision, reason: REASON, name: src.name, audience: src.audience, term_months: src.term_months, currency: src.currency,
      prices: [{ cadence: monthly, amount: money(90000) }], platform_limits: src.platform_limits,
      included_bundle_revision_ids: src.included_bundle_revision_ids, optional_bundle_revision_ids: src.optional_bundle_revision_ids,
      included_extra_branches: src.included_extra_branches, extra_branch_prices: src.extra_branch_prices, extra_branches_limit: src.extra_branches_limit,
      included_users: src.included_users, included_storage_mb: src.included_storage_mb, storage_step_mb: src.storage_step_mb,
      storage_step_threshold_mb: src.storage_step_threshold_mb, storage_large_step_mb: src.storage_large_step_mb,
      user_prices: src.user_prices, storage_prices: src.storage_prices, policy_revision_id: src.policy_revision_id,
      trial_days: src.trial_days, grace_days: src.grace_days, auto_suspend: src.auto_suspend, auto_renew_allowed: src.auto_renew_allowed,
    })
    expect(edited.status, JSON.stringify(edited.body)).toBe(200)
    const valid = await api('POST', `/plans/${src.id}/validate`, { edit_revision: edited.body.edit_revision, reason: REASON })
    plan = (await api('POST', `/plans/${src.id}/publish`, { edit_revision: valid.body.edit_revision, reason: REASON })).body
    expect(plan.status).toBe('published')

    const renewal = await renew(bought.id, '2027-01-01')
    expect(renewal).not.toBeNull()
    expect(renewal!.order.due_now.minor).toBe(bought.quote.next_renewal.minor)
    expect(renewal!.order.due_now.minor).toBeLessThan(90000)
    expect(renewal!.invoice!.total.minor).toBe(bought.quote.next_renewal.minor)
    // A renewal does not open a target revision. The catalog push delivers the feature change.
    expect(renewal!.order.target_revision_id).toBe(applied.applied_revision_id)
    expect((await appliedOf(bought.id)).target_revision_id).toBeNull()
  })

  it('keeps the pinned entitlement when the latest release refuses to compile', async () => {
    const bought = await subscribe(plan.id)
    const applied = await appliedOf(bought.id)
    await publish(catalog('drop'))
    const incompatibilities = async () => (await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='catalog_release.entitlement_incompatible' AND subject=$1", [bought.id])).rows[0].n
    const recorded = await incompatibilities()
    const logged: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation(line => { logged.push(String(line)) })
    let renewal: Awaited<ReturnType<typeof renew>>
    try {
      renewal = await renew(bought.id, '2027-02-01')
    } finally {
      spy.mockRestore()
    }
    expect(renewal).not.toBeNull()
    expect(logged.some(line => line.includes('commercial_entitlement_recompile_fallback'))).toBe(true)
    expect(renewal!.order.target_revision_id).toBe(applied.applied_revision_id)
    expect(renewal!.order.due_now.minor).toBe(bought.quote.next_renewal.minor)
    const quote = (await pool.query('SELECT payload FROM commercial_quotes WHERE id=$1', [renewal!.order.quote_id])).rows[0].payload
    expect(quote.entitlement_digest).toBe(applied.snapshot.entitlement.digest)
    expect((await appliedOf(bought.id)).snapshot.entitlement.digest).toBe(applied.snapshot.entitlement.digest)
    expect(await incompatibilities()).toBe(recorded + 1)
  })

  it('reports a failed push and creates no order when a release removes an owned application', async () => {
    const bought = await subscribe(plan.id)
    const created = await publishResponse(catalog('drop'))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.id).toBeTruthy()
    expect(created.body.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ subscription_id: bought.id, code: 'unknown_app' }),
    ]))
    expect(await catalogOrders(bought.id)).toBe(0)
    expect((await pool.query('SELECT target_revision_id FROM subscriptions WHERE id=$1', [bought.id])).rows[0].target_revision_id).toBeNull()
    expect((await pool.query("SELECT reason FROM audit_events WHERE action='catalog_release.entitlement_incompatible' AND subject=$1", [bought.id])).rows[0].reason).toBe('unknown_app')
  })

  it('refuses a release that removes a limit the customer exceeds and creates no change order', async () => {
    const bought = await subscribe(plan.id)
    const tenant = (await pool.query('SELECT tenant_id FROM subscriptions WHERE id=$1', [bought.id])).rows[0].tenant_id
    await recordUsage(pool, { tenant_id: tenant, observed_at: new Date(), metrics: { [LIMIT]: 5 }, limit_gates: { [LIMIT]: ['pmo.enabled'] }, source: 'catalog-follow' })
    const created = await publishResponse(catalog('drop-limit'))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ subscription_id: bought.id, code: 'downgrade_below_usage', field: LIMIT, used: 5 }),
    ]))
    expect(await catalogOrders(bought.id)).toBe(0)
    expect((await pool.query('SELECT target_revision_id FROM subscriptions WHERE id=$1', [bought.id])).rows[0].target_revision_id).toBeNull()
  })
})
