/** Spec 3.6 acceptance (plan 2026-10-07-phase-3b, Task 6). Runs only against a scratch control
 * database and the one scratch Odoo tenant named by NASQ_PACKAGES_ACCEPTANCE_DB, through the real
 * compiler, quotes, orders, usage collector and the real Python effect. Plan values are fixtures. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { fileURLToPath } from 'node:url'
import * as orders from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { collectUsage } from '../commercial/usage-collector.js'
import { deriveSharedPolicy } from '../shared/job-store.js'
import { migrate } from '../db.js'
import { client, money, monthly, url } from './commercial-helpers.js'

const DB = process.env.NASQ_PACKAGES_ACCEPTANCE_DB
const ODOO = process.env.NASQ_PACKAGES_ACCEPTANCE_URL
const ready = Boolean(url && DB && ODOO && process.env.NASQ_SCRATCH_ODOO_SHELL && /^nasq_scratch_[a-f0-9]{32}$/.test(DB ?? ''))
const suite = ready ? describe : describe.skip
const repo = fileURLToPath(new URL('../../../..', import.meta.url))
const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const HOST = 'accept.packages.test'

function effect(request: Record<string, unknown>) {
  const done = spawnSync('python3', ['-B', '-m', 'tools.shared_saas_lifecycle.scratch_effect'], {
    cwd: repo, input: JSON.stringify(request), encoding: 'utf8', timeout: 1_800_000,
    env: { ...process.env, NASQ_SCRATCH_JOURNAL: process.env.NASQ_SCRATCH_JOURNAL ?? '/private/tmp/nasq-packages/journal' },
  })
  const line = done.stdout.trim().split('\n').at(-1) ?? '{}'
  return JSON.parse(line) as { result?: any; error_code?: string }
}
function odooShell(script: string) {
  return spawnSync(process.env.NASQ_SCRATCH_ODOO_SHELL!, [DB!], { input: script, encoding: 'utf8', timeout: 900_000 }).stdout
}
async function session() {
  const r = await fetch(`${ODOO}/web/session/authenticate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: DB, login: 'admin', password: 'admin' }, id: 1 }) })
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
  expect(cookie).toMatch(/^session_id=/)
  return cookie
}
async function odooApi(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${ODOO}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) as any }
}

suite('spec 3.6 acceptance: plans flip keys and limits on a tenant with every app installed', { timeout: 600_000 }, () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool, ['vendor.read', 'vendor.catalog.manage', 'vendor.pricing.manage'] as any)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage'] }
  const reason = 'Phase 3 acceptance'
  const solution = JSON.parse(readFileSync(`${repo}deploy/catalog/solutions/platform_v3.json`, 'utf8'))
  solution.tiers.push({ id: 'probe', name: 'Probe', description: 'Registry probe (acceptance only).', modules: [], features: ['boolean:probe.enabled'] })
  const state: Record<string, any> = {}

  async function publish(kind: 'bundles' | 'plans', body: Record<string, unknown>) {
    const created = await api('POST', `/${kind}`, body)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const validated = await api('POST', `/${kind}/${created.body.id}/validate`, { edit_revision: 1, reason })
    const published = await api('POST', `/${kind}/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })
    expect(published.body.status).toBe('published')
    return published.body
  }
  const plan = (name: string, bundles: string[], users: number) => publish('plans', { name, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
    prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: { 'users.limit': users, 'storage.limit_mb': 1000 }, included_bundle_revision_ids: bundles,
    optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: 0,
    policy_revision_id: POLICY, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
  /** Real collector pass over the real Odoo observation (a downgrade or reopen quote needs a fresh sample). */
  async function collect() {
    return collectUsage(pool, { runner: async ({ database }) => {
      const out = effect({ action: 'observe', tenant: { database, host: HOST } })
      if (out.error_code) throw Error(out.error_code)
      return { database: out.result.database, observed_at: out.result.observed_at, usage: out.result.usage, limit_gates: out.result.limit_gates }
    } })
  }
  async function order(kind: 'new' | 'change', planId: string) {
    const q = await createQuoteForCustomer(pool, { customer_id: state.customer, request: { kind, plan_revision_id: planId, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0 } }, new Date())
    const { order: o } = await orders.acceptQuote(pool, { quote_id: q.id, expected_subscription_revision: q.expected_subscription_revision, idempotency_key: randomUUID() }, vendor)
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [o.target_revision_id])).rows[0].snapshot
    return { order: o, snapshot }
  }
  async function apply(o: { order: any; snapshot: any }) {
    const e = o.snapshot.entitlement
    const out = effect({ action: 'reconfigure', tenant: { database: DB, host: HOST }, order_id: o.order.id, operation_id: randomUUID(),
      previous_revision_id: state.applied ?? null, target_revision_id: o.order.target_revision_id,
      entitlement: { modules: e.modules, features: e.features, digest: e.digest, compiler_version: e.compiler_version }, branches: { apply: [], archive: [] } })
    expect(out.error_code, JSON.stringify(out)).toBeUndefined()
    // Payment and fulfilment are outside this proof; mark applied as commercial-downgrade.test.ts does.
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [o.order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',revision=revision+1 WHERE id=$1", [o.order.subscription_id])
    state.applied = o.order.target_revision_id
    return out.result
  }
  function observed() {
    const out = effect({ action: 'observe', tenant: { database: DB, host: HOST } })
    expect(out.error_code, JSON.stringify(out)).toBeUndefined()
    return out.result
  }

  beforeAll(async () => {
    await migrate(pool)
    const raw = Buffer.from(JSON.stringify(solution))
    state.version = `acceptance-${randomUUID()}`
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), state.version, solution, createHash('sha256').update(raw).digest('hex')])
  })
  afterAll(async () => pool.end())

  it('4: an app that only registered its keys and got a catalog tier appears in the release and in a bundle', async () => {
    const release = (await api('POST', '/catalog/releases', { catalog_version: state.version, reason })).body
    const probe = release.applications.find((a: any) => a.id === 'probe')
    expect(probe).toMatchObject({ name_en: 'probe', selectable: true })
    expect(probe.features.map((f: any) => f.key)).toEqual(['probe.enabled'])
    state.release = release
    const bundle = (id: string, keys: string[], limits: Record<string, number> = {}) => publish('bundles', { name: `${id} ${randomUUID()}`, description: id, audience: { kind: 'public' },
      catalog_release_id: release.id, selections: [{ app_id: id, feature_keys: keys }], domain_limits: limits, prices: [{ cadence: monthly, amount: money(0) }] })
    state.projects = await bundle('projects', ['pmo.enabled', 'meetings.enabled'], { 'projects.max_projects': 5 })
    state.people = await bundle('people', ['hr.enabled'])
    state.probe = await bundle('probe', ['probe.enabled'])
    console.log('ACCEPT_4', JSON.stringify({ app: probe.id, features: probe.features.map((f: any) => f.key), bundle: state.probe.id }))
  })

  it('1: a plan with two or more apps is applied to the tenant and the applied keys match the compiled ones', async () => {
    state.full = await plan(`Full ${randomUUID()}`, [state.projects.id, state.people.id, state.probe.id], 10)
    state.peopleOnly = await plan(`People ${randomUUID()}`, [state.people.id, state.probe.id], 10)
    state.small = await plan(`Small ${randomUUID()}`, [state.people.id, state.probe.id], 1)
    const policy = deriveSharedPolicy(solution, 'core')
    // The tenant has the test-only probe addon installed; provisioning compares installed addons with the policy closure.
    // Reconfigure refuses test-only addons in an entitlement, so the probe tier itself lists no module (modules: []).
    policy.modules.push('nasq_registry_probe')
    const provisioned = effect({ action: 'provision', tenant: { database: DB, host: HOST }, policy })
    expect(provisioned.error_code, JSON.stringify(provisioned)).toBeUndefined()
    expect(provisioned.result.policy_revision).toBe(1)
    state.tenant = randomUUID(); state.customer = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Acceptance','saas','managed',$2,true)", [state.tenant, `inv-${state.tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [state.customer, 'Acceptance', state.tenant])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [state.tenant, 'tacceptance', HOST, DB])
    const full = await order('new', state.full.id)
    const receipt = await apply(full)
    expect(receipt.modules_installed).toEqual([])
    const seen = observed()
    const mismatched = Object.entries(full.snapshot.entitlement.features).filter(([k, v]) => seen.features[k] !== v)
    expect(mismatched).toEqual([])
    expect(Object.keys(seen.features).sort()).toEqual(Object.keys(full.snapshot.entitlement.features).sort())
    const cookie = await session()
    expect((await odooApi(cookie, 'POST', '/api/v1/projects', { name: 'Acceptance project', date_end: '2030-12-31' })).status).toBe(201)
    console.log('ACCEPT_1', JSON.stringify({ apps: ['projects', 'people', 'probe'], keys: Object.keys(seen.features).length, mismatched: mismatched.length }))
  })

  it('2: downgrading to a plan without projects closes its routes with 403 and keeps its data', async () => {
    const before = observed().usage['projects.max_projects']
    expect(before).toBeGreaterThanOrEqual(1)
    expect((await collect()).recorded).toBeGreaterThanOrEqual(1)
    const receipt = await apply(await order('change', state.peopleOnly.id))
    expect(receipt.modules_installed).toEqual([])
    const cookie = await session()
    expect((await odooApi(cookie, 'GET', '/api/v1/projects?minimal=1')).status).toBe(200)
    const blocked = await odooApi(cookie, 'POST', '/api/v1/projects', { name: 'Blocked', date_end: '2030-12-31' })
    expect([blocked.status, blocked.body?.code]).toEqual([403, 'feature_not_included'])
    const after = observed()
    expect(after.usage['projects.max_projects']).toBe(before)
    expect(after.features['pmo.enabled']).toBe(false)
    console.log('ACCEPT_2', JSON.stringify({ status: blocked.status, code: blocked.body?.code, projects_before: before, projects_after: after.usage['projects.max_projects'] }))
  })

  it('3: upgrading back restores access at once with no install job', async () => {
    expect((await collect()).recorded).toBeGreaterThanOrEqual(1)
    const receipt = await apply(await order('change', state.full.id))
    expect(receipt.modules_installed).toEqual([])
    const cookie = await session()
    expect((await odooApi(cookie, 'POST', '/api/v1/projects', { name: 'Open again', date_end: '2030-12-31' })).status).toBe(201)
    console.log('ACCEPT_3', JSON.stringify({ modules_installed: receipt.modules_installed }))
  })

  it('5: a downgrade below real collected usage is refused', async () => {
    const request = { kind: 'change' as const, plan_revision_id: state.small.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0 }
    // Earlier steps collected samples; without a fresh sample the downgrade is refused as unavailable.
    await pool.query("UPDATE usage_snapshots SET freshness='stale' WHERE tenant_id=$1", [state.tenant])
    await expect(createQuoteForCustomer(pool, { customer_id: state.customer, request }, new Date())).rejects.toMatchObject({ status: 409, code: 'usage_unavailable', field: 'users.limit' })
    const created = odooShell("for n in ('one', 'two'):\n    env['res.users'].create({'name': 'Accept ' + n, 'login': 'accept-' + n + '@packages.test', 'group_ids': [(4, env.ref('nasq_core.group_employee').id)]})\nenv.cr.commit()\nprint('ACCEPT_USERS', env['nasq.entitlement.service']._nasq_count_users())\n")
    expect(created).toMatch(/ACCEPT_USERS [2-9]/)
    const collected = await collect()
    expect(collected.recorded).toBeGreaterThanOrEqual(1)
    const sample = (await pool.query('SELECT metrics FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1', [state.tenant])).rows[0].metrics
    expect(sample['users.limit']).toBeGreaterThanOrEqual(2)
    await expect(createQuoteForCustomer(pool, { customer_id: state.customer, request }, new Date())).rejects.toMatchObject({ status: 422, code: 'downgrade_below_usage', field: 'users.limit' })
    console.log('ACCEPT_5', JSON.stringify({ users: sample['users.limit'], limit: 1, refused: 'downgrade_below_usage' }))
  })
})
