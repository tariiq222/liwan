import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const suite = url ? describe : describe.skip
suite('commercial plans', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool)
  const reason = 'Test plan lifecycle'
  let release: any, sel: any
  const bundleBody = (over: any = {}) => ({ name: `B ${randomUUID()}`, description: 'd', audience: { kind: 'public' }, catalog_release_id: release.id,
    selections: [{ app_id: sel.app, feature_keys: [sel.feature] }], domain_limits: {}, prices: [{ cadence: monthly, amount: money(0) }], ...over })
  const planBody = (over: any = {}) => ({ name: `P ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
    prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
    included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(50000) }], extra_branches_limit: 5,
    included_users: 3, included_storage_mb: 5120, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(2500) }], storage_prices: [{ cadence: monthly, amount: money(500) }], policy_revision_id: POLICY,
    trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: true, ...over })
  async function publishedBundle(over: any = {}) {
    const c = await api('POST', '/bundles', bundleBody(over))
    const v = await api('POST', `/bundles/${c.body.id}/validate`, { edit_revision: 1, reason })
    const p = await api('POST', `/bundles/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason })
    expect(p.status).toBe(200); return p.body
  }
  const validate = async (id: string, edit = 1) => api('POST', `/plans/${id}/validate`, { edit_revision: edit, reason })
  const codes = (r: any) => r.body.issues.map((i: any) => i.code)
  beforeAll(async () => {
    const { version } = await setup(pool)
    release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.selectable && a.features.some((f: any) => f.selectable))
    sel = { app: app.id, feature: app.features.find((f: any) => f.selectable).key }
  })
  afterAll(async () => { await pool.end() })

  it('runs the full lifecycle and records bundle references', async () => {
    const b = await publishedBundle()
    const c = await api('POST', '/plans', planBody({ included_bundle_revision_ids: [b.id] }))
    expect(c.status).toBe(201)
    const v = await validate(c.body.id); expect(v.status).toBe(200)
    const p = await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason })
    expect(p.body.available).toBe(true)
    expect((await api('GET', `/bundles/${b.id}`)).body.customer_count).toBe(0)
    const w = await api('POST', `/plans/${c.body.id}/withdraw`, { edit_revision: p.body.edit_revision, reason })
    const r = await api('POST', `/plans/${c.body.id}/restore`, { edit_revision: w.body.edit_revision, reason })
    const rev = await api('POST', `/plans/${c.body.id}/revisions`, { edit_revision: r.body.edit_revision, reason })
    expect(rev.status).toBe(201); expect(rev.body.version).toBe(2)
    expect((await api('DELETE', `/bundles/${b.id}`, { edit_revision: b.edit_revision, reason })).status).toBe(409)
  })
  it('counts customers on a plan and on a bundle, not the plans that reference a bundle', async () => {
    const [b1, b2, unused] = [await publishedBundle(), await publishedBundle(), await publishedBundle()]
    const c = await api('POST', '/plans', planBody({ included_bundle_revision_ids: [b1.id], optional_bundle_revision_ids: [b2.id, unused.id] }))
    const v = await validate(c.body.id)
    const p = await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason })
    expect(p.status).toBe(200)
    // One customer applied the plan with b1 and b2; another has the plan with b2 as its pending target only; a third is on nothing.
    const subscribe = async (applied: object | null, target: object | null) => {
      const customer = randomUUID(), sub = randomUUID(), revision = randomUUID()
      await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer, `Count ${customer}`])
      await pool.query('INSERT INTO subscriptions(id,customer_id,state) VALUES($1,$2,$3)', [sub, customer, 'active'])
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, JSON.stringify(applied ?? target), randomUUID()])
      await pool.query('UPDATE subscriptions SET revision=1,applied_revision_id=$2,target_revision_id=$3 WHERE id=$1', [sub, applied ? revision : null, revision])
    }
    await subscribe({ plan_revision_id: c.body.id, bundle_revision_ids: [b1.id, b2.id] }, null)
    await subscribe(null, { plan_revision_id: c.body.id, bundle_revision_ids: [b2.id] })
    const count = async (kind: 'plans' | 'bundles', id: string) => (await api('GET', `/${kind}/${id}`)).body.customer_count
    expect(await count('plans', c.body.id)).toBe(2)
    expect(await count('bundles', b1.id)).toBe(1)
    expect(await count('bundles', b2.id)).toBe(2)
    expect(await count('bundles', unused.id)).toBe(0)
    const listed = (await api('GET', '/plans?limit=200')).body.items.find((x: any) => x.id === c.body.id)
    expect(listed.customer_count).toBe(2)
  })
  it('refuses numbers the integer columns or the workspace cannot take, as a 422 naming the field', async () => {
    const over = { included_users: 2_147_483_648, included_storage_mb: 2_147_483_648, included_extra_branches: 2_147_483_648, extra_branches_limit: 2_147_483_648 }
    for (const [field, value] of Object.entries(over)) {
      const r = await api('POST', '/plans', planBody({ [field]: value }))
      expect([r.status, r.body.field], field).toEqual([422, field])
    }
    // A limit the plan hands to a workspace must be one the workspace accepts (0 to 1,000,000,000).
    const limit = await api('POST', '/plans', planBody({ platform_limits: { 'tasks.limit': 1_000_000_001 } }))
    expect([limit.status, limit.body.field]).toEqual([422, 'platform_limits'])
    const created = await api('POST', '/plans', planBody({ included_users: 1_000_000_000, platform_limits: { 'tasks.limit': 1_000_000_000 } }))
    expect(created.status).toBe(201)
    // An edit revision past the column is a parse refusal (the HTTP layer answers 422), not a database range error.
    await expect(api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 2_147_483_648, reason })).rejects.toMatchObject({ name: 'ZodError' })
  })
  it('requires every storage step to be a whole number of gigabytes at validate', async () => {
    const c = await api('POST', '/plans', planBody({ storage_step_mb: 1000, storage_step_threshold_mb: 100000, storage_large_step_mb: 100000 }))
    expect(c.status).toBe(201)
    const v = await validate(c.body.id)
    expect(v.status).toBe(422)
    expect(v.body.issues).toEqual(expect.arrayContaining([{ code: 'storage_step_not_whole_gb', field: 'storage_step_mb' }, { code: 'storage_step_not_whole_gb', field: 'storage_step_threshold_mb' }, { code: 'storage_step_not_whole_gb', field: 'storage_large_step_mb' }]))
  })
  it('re-checks a plan when it is restored and leaves one available revision', async () => {
    const b = await publishedBundle()
    const c = await api('POST', '/plans', planBody({ optional_bundle_revision_ids: [b.id] }))
    const v1 = await validate(c.body.id)
    const p1 = await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v1.body.edit_revision, reason })
    const w1 = await api('POST', `/plans/${c.body.id}/withdraw`, { edit_revision: p1.body.edit_revision, reason })
    expect(w1.status).toBe(200)
    // The bundle goes away while the plan is withdrawn: restoring would sell a plan that cannot be quoted.
    const wb = await api('POST', `/bundles/${b.id}/withdraw`, { edit_revision: b.edit_revision, reason })
    expect(wb.status).toBe(200)
    const refused = await api('POST', `/plans/${c.body.id}/restore`, { edit_revision: w1.body.edit_revision, reason })
    expect(refused.status).toBe(422); expect(refused.body.issues.map((i: any) => i.code)).toContain('bundle_unavailable')
    expect((await pool.query('SELECT available FROM plan_revisions WHERE id=$1', [c.body.id])).rows[0].available).toBe(false)
    // A newer revision is published meanwhile; restoring the old one then replaces it rather than selling both.
    const ok = await api('POST', '/plans', planBody())
    const v2 = await validate(ok.body.id)
    const p2 = await api('POST', `/plans/${ok.body.id}/publish`, { edit_revision: v2.body.edit_revision, reason })
    const w2 = await api('POST', `/plans/${ok.body.id}/withdraw`, { edit_revision: p2.body.edit_revision, reason })
    const rev = await api('POST', `/plans/${ok.body.id}/revisions`, { edit_revision: w2.body.edit_revision, reason })
    const v3 = await validate(rev.body.id)
    const p3 = await api('POST', `/plans/${rev.body.id}/publish`, { edit_revision: v3.body.edit_revision, reason })
    expect(p3.status).toBe(200)
    const back = await api('POST', `/plans/${ok.body.id}/restore`, { edit_revision: p2.body.edit_revision + 1, reason })
    expect(back.status).toBe(200)
    const sellable = (await pool.query("SELECT id FROM plan_revisions WHERE plan_id=$1 AND status='published' AND available", [ok.body.plan_id])).rows
    expect(sellable).toEqual([{ id: ok.body.id }])
  })
  it('refuses a plan that still carries a metered limit', async () => {
    const c = await api('POST', '/plans', planBody({ platform_limits: { 'users.limit': 5 } }))
    expect(c.status).toBe(201)
    const v = await validate(c.body.id)
    expect(codes(v)).toContain('platform_limit_derived')
  })
  it('leaves exactly one sellable revision after publishing a successor', async () => {
    const c = await api('POST', '/plans', planBody())
    const v1 = await validate(c.body.id)
    const p1 = await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v1.body.edit_revision, reason })
    const rev = await api('POST', `/plans/${c.body.id}/revisions`, { edit_revision: p1.body.edit_revision, reason })
    const v2 = await validate(rev.body.id)
    const p2 = await api('POST', `/plans/${rev.body.id}/publish`, { edit_revision: v2.body.edit_revision, reason })
    expect(p2.status).toBe(200)
    const sellable = (await pool.query("SELECT id FROM plan_revisions WHERE plan_id=$1 AND status='published' AND available", [c.body.plan_id])).rows
    expect(sellable).toHaveLength(1)
    expect(sellable[0].id).toBe(rev.body.id)
    const audit = (await pool.query("SELECT metadata FROM audit_events WHERE action='plan.withdrawn_by_publish' AND subject=$1", [rev.body.id])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0].metadata.predecessor_id).toBe(c.body.id)
  })
  it('seeds exactly one sellable LiwanOS plan with no included applications', async () => {
    const rows = (await pool.query("SELECT * FROM plan_revisions WHERE status='published' AND available AND name='LiwanOS'")).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].included_bundle_revision_ids).toEqual([])
    // The seeded LiwanOS plan costs nothing, so it carries no trial: a free trial could only end past_due.
    expect(rows[0].trial_days).toBe(0)
    expect(rows[0].included_users).toBe(3)
    // A10 (owner decision 2026-11-07): the seeded base includes 20 GiB.
    expect(rows[0].included_storage_mb).toBe(20480)
  })
  it('reads back the new plan columns', async () => {
    const c = await api('POST', '/plans', planBody({ included_users: 3, included_storage_mb: 5120, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(2500) }], storage_prices: [{ cadence: monthly, amount: money(500) }] }))
    expect(c.status).toBe(201)
    const row = (await api('GET', `/plans/${c.body.id}`)).body
    expect(row.included_users).toBe(3)
    expect(row.included_storage_mb).toBe(5120)
    expect(row.user_prices).toHaveLength(1)
    expect(row.storage_prices).toHaveLength(1)
  })
  it('refuses an included storage minimum that is not a whole gigabyte', async () => {
    const c = await api('POST', '/plans', planBody({ included_storage_mb: 5000 }))
    expect(c.status).toBe(201)
    expect(codes(await validate(c.body.id))).toContain('storage_minimum_not_whole_gb')
  })
  it('refuses a monthly plan with no monthly users unit price', async () => {
    const c = await api('POST', '/plans', planBody({ prices: [{ cadence: monthly, amount: money(299) }], user_prices: [] }))
    expect(c.status).toBe(201)
    expect(codes(await validate(c.body.id))).toContain('unit_price_missing')
  })
  it('accepts a zero price', async () => {
    const c = await api('POST', '/plans', planBody({ prices: [{ cadence: monthly, amount: money(0) }] }))
    expect((await validate(c.body.id)).status).toBe(200)
  })
  it('rejects invalid plans with issues', async () => {
    const mk = async (over: any) => validate((await api('POST', '/plans', planBody(over))).body.id)
    expect(codes(await mk({ prices: [] }))).toContain('price_missing')
    expect(codes(await mk({ prices: [{ cadence: monthly, amount: { ...money(1), currency: 'USD' } }] }))).toContain('currency_mismatch')
    expect(codes(await mk({ extra_branch_prices: [] }))).toContain('branch_price_missing')
    expect(await mk({ extra_branch_prices: [], extra_branches_limit: 1 })).toMatchObject({ status: 200 })
    expect(codes(await mk({ extra_branches_limit: 0, included_extra_branches: 2 }))).toContain('branch_limit_invalid')
    expect(codes(await mk({ term_months: 5, prices: [{ cadence: { unit: 'month', count: 3 }, amount: money(1) }], extra_branches_limit: 0, included_extra_branches: 0 }))).toContain('term_not_multiple')
    const b = await publishedBundle()
    expect(codes(await mk({ included_bundle_revision_ids: [b.id], optional_bundle_revision_ids: [b.id] }))).toContain('bundle_duplicated')
    const draft = await api('POST', '/bundles', bundleBody())
    expect(codes(await mk({ included_bundle_revision_ids: [draft.body.id] }))).toContain('bundle_unavailable')
    const priv = await publishedBundle({ audience: { kind: 'customer', customer_id: 'cust-a' } })
    expect(codes(await mk({ included_bundle_revision_ids: [priv.id] }))).toContain('bundle_audience_mismatch')
    expect((await mk({ included_bundle_revision_ids: [priv.id], audience: { kind: 'customer', customer_id: 'cust-a' } })).status).toBe(200)
  })
  it('compiles aggregate entitlements, binds policy currency and optional prices', async () => {
    const mk = async (over: any) => validate((await api('POST', '/plans', planBody(over))).body.id)
    expect(codes(await mk({ currency: 'USD', prices: [{ cadence: monthly, amount: { ...money(1), currency: 'USD' } }], extra_branch_prices: [{ cadence: monthly, amount: { ...money(1), currency: 'USD' } }] }))).toContain('currency_not_supported')
    expect(codes(await mk({ platform_limits: { 'nope.limit': 1 } }))).toContain('limit_not_supported')
    expect(codes(await mk({ platform_limits: { 'branches.extra_limit': 3 } }))).toContain('platform_limit_derived')
    expect(codes(await mk({ platform_limits: { 'projects.max_projects': 3 } }))).toContain('limit_not_supported')
    expect(codes(await mk({ platform_limits: { 'users.limit': 10, 'storage.limit_mb': 100 } }))).toContain('platform_limit_derived')
    // The chosen quantity must admit the required customer administrator.
    expect(codes(await mk({ included_users: 0 }))).toContain('users_limit_admin_required')
    expect((await mk({ included_users: 1 })).status).toBe(200)
    // schema_023 holds the same floor in the database, so no stored plan or terms can carry a 0.
    const old = (await api('POST', '/plans', planBody({ included_users: 1 }))).body
    await expect(pool.query(`UPDATE plan_revisions SET platform_limits=jsonb_set(platform_limits,'{users.limit}','0'),edit_revision=edit_revision+1 WHERE id=$1`, [old.id]))
      .rejects.toThrow('plan_revisions_users_limit_admits_admin')
    const floor = async (limits: unknown) => (await pool.query('SELECT commercial_users_limit_admits_admin($1::jsonb) AS ok', [JSON.stringify(limits)])).rows[0].ok
    expect(await Promise.all([null, {}, { 'users.limit': null }, { 'users.limit': 1 }, { 'storage.limit_mb': 0 }].map(floor))).toEqual([true, true, true, true, true])
    expect(await Promise.all([{ 'users.limit': 0 }, { 'users.limit': -1 }, { 'users.limit': 1.5 }, { 'users.limit': '1' }, { 'users.limit': true }].map(floor))).toEqual([false, false, false, false, false])
    const unpriced = await publishedBundle({ prices: [] })
    expect(codes(await mk({ optional_bundle_revision_ids: [unpriced.id] }))).toContain('price_missing')
    expect((await mk({ included_bundle_revision_ids: [unpriced.id] })).status).toBe(200)
    const lim = release.applications.flatMap((a: any) => a.features.filter((f: any) => f.kind === 'limit' && !a.selectable))
    const dom = release.applications.find((a: any) => a.selectable && a.features.some((f: any) => f.kind === 'limit'))
    if (dom) {
      const key = dom.features.find((f: any) => f.kind === 'limit').key
      const b1 = await publishedBundle({ selections: [{ app_id: dom.id, feature_keys: [] }], domain_limits: { [key]: 1 } })
      const b2 = await publishedBundle({ selections: [{ app_id: dom.id, feature_keys: [] }], domain_limits: { [key]: 2 } })
      expect(codes(await mk({ included_bundle_revision_ids: [b1.id], optional_bundle_revision_ids: [b2.id] }))).toContain('ambiguous_limit')
    }
    void lim
  })
  it('rejects wrong currency exponent and serializes stale writers', async () => {
    const zero = { currency: 'SAR', exponent: 0, minor: 5 }
    const r = await validate((await api('POST', '/plans', planBody({ prices: [{ cadence: monthly, amount: zero }], extra_branch_prices: [{ cadence: monthly, amount: zero }] }))).body.id)
    expect(codes(r)).toContain('currency_exponent_invalid')
    const c = await api('POST', '/plans', planBody())
    const rs = await Promise.all([validate(c.body.id), validate(c.body.id)])
    expect(rs.map(x => x.status).sort()).toEqual([200, 409])
    const v = await api('GET', `/plans/${c.body.id}`)
    await expect(pool.query("UPDATE plan_revisions SET name='tampered' WHERE id=$1", [c.body.id])).rejects.toThrow()
    await pool.query("UPDATE plan_revisions SET name='tampered',edit_revision=edit_revision+1 WHERE id=$1", [c.body.id])
    const after = (await pool.query('SELECT status,validated_digest FROM plan_revisions WHERE id=$1', [c.body.id])).rows[0]
    expect(after).toMatchObject({ status: 'draft', validated_digest: null }); expect(v.body.status).toBe('validated')
  })
  it('bundle with prices needs pricing capability; bundle currency/exponent bound to policy', async () => {
    const cat = client(pool, ['vendor.read', 'vendor.catalog.manage'])
    const r = await cat('POST', '/bundles', bundleBody({ prices: [{ cadence: monthly, amount: money(5) }] }))
    expect(r.status).toBe(403)
    expect((await cat('POST', '/bundles', bundleBody({ prices: [] }))).status).toBe(201)
    const usd = await api('POST', '/bundles', bundleBody({ prices: [{ cadence: monthly, amount: { currency: 'USD', exponent: 2, minor: 1 } }] }))
    const v1 = await api('POST', `/bundles/${usd.body.id}/validate`, { edit_revision: 1, reason })
    expect(v1.status).toBe(422); expect(v1.body.issues.map((i: any) => i.code)).toContain('currency_not_supported')
    const e0 = await api('POST', '/bundles', bundleBody({ prices: [{ cadence: monthly, amount: { currency: 'SAR', exponent: 0, minor: 1 } }] }))
    const v2 = await api('POST', `/bundles/${e0.body.id}/validate`, { edit_revision: 1, reason })
    expect(v2.body.issues.map((i: any) => i.code)).toContain('currency_exponent_invalid')
  })
  it('requires both catalog and pricing capabilities and guards stale revisions', async () => {
    const c = await api('POST', '/plans', planBody())
    for (const caps of [['vendor.read', 'vendor.catalog.manage'], ['vendor.read', 'vendor.pricing.manage']]) {
      const r = await client(pool, caps)('POST', '/plans', planBody())
      expect(r.status).toBe(403); expect(r.body.code).toBe('forbidden')
    }
    expect((await client(pool, ['vendor.read'])('GET', `/plans/${c.body.id}`)).status).toBe(200)
    const stale = await api('PATCH', `/plans/${c.body.id}`, { ...planBody(), edit_revision: 9, reason })
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('revision_conflict')
    expect((await api('GET', `/plans?status=draft&q=nomatch-${randomUUID()}`)).body.total).toBe(0)
  })
  it('deletes drafts only', async () => {
    const c = await api('POST', '/plans', planBody())
    expect((await api('DELETE', `/plans/${c.body.id}`, { edit_revision: 1, reason })).status).toBe(200)
    expect((await api('GET', `/plans/${c.body.id}`)).status).toBe(404)
  })
})
