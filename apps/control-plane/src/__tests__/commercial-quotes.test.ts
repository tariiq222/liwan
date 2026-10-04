import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const suite = url ? describe : describe.skip
suite('commercial quotes', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool)
  const reason = 'Test quote preview'
  let plan: any
  const plan0 = (over: any = {}) => ({ name: `P ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
    prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
    included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(50000) }], extra_branches_limit: null, policy_revision_id: POLICY,
    trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true, ...over })
  async function publishPlan(over: any = {}) {
    const c = await api('POST', '/plans', plan0(over))
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason })
    const p = await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason })
    expect(p.status).toBe(200); return p.body
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason })
    plan = await publishPlan()
  })
  afterAll(async () => { await pool.end() })

  it('lists the approved pricing policy', async () => {
    const r = await api('GET', '/policies')
    expect(r.body.items.find((p: any) => p.id === POLICY)).toMatchObject({ timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'vat_exclusive', rate_bps: 1500 } })
  })
  it('HQ + 3 extra with 1 free → 2 paid branches: 100000 + VAT 15000, readback identical', async () => {
    const q = await api('POST', '/quotes', { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 3 })
    expect(q.status).toBe(201)
    expect(q.body.lines.find((l: any) => l.kind === 'branch')).toMatchObject({ quantity: 2, amount: { minor: 100000 } })
    expect(q.body.lines.find((l: any) => l.kind === 'tax').amount.minor).toBe(15000)
    expect(q.body.due_now.minor).toBe(115000)
    const g = await api('GET', `/quotes/${q.body.id}`)
    expect(g.body).toEqual(q.body)
    expect(new Date(q.body.expires_at).getTime() - Date.now()).toBeGreaterThan(29 * 60_000)
  })
  it('rejects client totals (strict body) and unpublished plans', async () => {
    const base = { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0 }
    const bad = await api('POST', '/quotes', { ...base, due_now: money(1) })
    expect(bad.status).toBe(422)
    const draft = await api('POST', '/plans', plan0())
    expect((await api('POST', '/quotes', { ...base, plan_revision_id: draft.body.id })).status).toBe(422)
    expect((await api('POST', '/quotes', { ...base, plan_revision_id: randomUUID() })).status).toBe(404)
  })
  it('enforces the branch limit and quote immutability', async () => {
    const limited = await publishPlan({ extra_branches_limit: 2 })
    const r = await api('POST', '/quotes', { kind: 'new', plan_revision_id: limited.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 3 })
    expect(r.status).toBe(422); expect(r.body.code).toBe('branch_limit_exceeded')
    const q = await api('POST', '/quotes', { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0 })
    await expect(pool.query("UPDATE commercial_quotes SET customer_id='x' WHERE id=$1", [q.body.id])).rejects.toThrow('quote_immutable')
    expect((await client(pool, [])('GET', `/quotes/${q.body.id}`)).status).toBe(403)
  })
})
