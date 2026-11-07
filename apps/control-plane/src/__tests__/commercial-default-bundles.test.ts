import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { url, setup, client } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('default bundles for a catalog release', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool)
  const reason = 'Seed the default bundle set'
  let release: any
  beforeAll(async () => {
    const { version } = await setup(pool)
    release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
  })
  afterAll(async () => { await pool.end() })

  it('publishes one bundle per selectable application and lists them on a new LiwanOS plan revision, once', async () => {
    const apps = release.applications.filter((a: any) => a.selectable)
    expect(apps.length).toBeGreaterThan(0)
    const first = await api('POST', `/catalog/releases/${release.id}/default-bundles`, { reason })
    expect(first.status).toBe(200)
    expect(first.body.bundles).toHaveLength(apps.length)
    expect(first.body.created).toHaveLength(apps.length)
    expect(first.body.plan_created).toBe(true)
    const plan = (await pool.query('SELECT status,available,optional_bundle_revision_ids FROM plan_revisions WHERE id=$1', [first.body.plan_revision_id])).rows[0]
    expect(plan).toMatchObject({ status: 'published', available: true })
    expect([...plan.optional_bundle_revision_ids].sort()).toEqual([...first.body.bundles].sort())
    const bundles = (await pool.query("SELECT status,available,prices FROM bundle_revisions WHERE id = ANY($1::uuid[])", [first.body.bundles])).rows
    expect(bundles.every(b => b.status === 'published' && b.available && b.prices.length === 2)).toBe(true)
    const again = await api('POST', `/catalog/releases/${release.id}/default-bundles`, { reason })
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ created: [], plan_created: false, plan_revision_id: first.body.plan_revision_id })
    expect([...again.body.bundles].sort()).toEqual([...first.body.bundles].sort())
  })
  it('starts every platform limit the release adds (the AI limits) unlimited, except the free assistant budget at its catalog ceiling, on the new plan revision', async () => {
    const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))
    const version = `commercial-${randomUUID()}`
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
    const platform = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const seeded = await api('POST', `/catalog/releases/${platform.id}/default-bundles`, { reason })
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200)
    const plan = (await pool.query('SELECT platform_limits FROM plan_revisions WHERE id=$1', [seeded.body.plan_revision_id])).rows[0]
    // The ceiling is the catalog's own value (100, owner decision 2026-11-06) and must match the seeded LiwanOS plan,
    // which carries 100; a higher default would quietly grant every customer a bigger budget than the plan sells.
    expect(plan.platform_limits).toEqual({ 'ai.messages.monthly': null, 'ai.tool_calls.per_run': null, 'ai.tokens.monthly': null, 'ai.assist.monthly': 100, 'ai.output_tokens.per_run': null })
  })
  it('drops the limits a newer release no longer declares when it seeds after a plan seeded from the previous release', async () => {
    const publish = async (text: string) => {
      const version = `commercial-${randomUUID()}`
      await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), version, JSON.parse(text), createHash('sha256').update(text).digest('hex')])
      return (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    }
    const raw = (await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))).toString()
    // The preceding release still names the budget `ai.setup.monthly`.
    const before = await publish(raw.replace('limit:ai.assist.monthly:100', 'limit:ai.setup.monthly'))
    const first = await api('POST', `/catalog/releases/${before.id}/default-bundles`, { reason })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const limitsOf = async (id: string) => (await pool.query('SELECT platform_limits FROM plan_revisions WHERE id=$1', [id])).rows[0].platform_limits
    expect(Object.keys(await limitsOf(first.body.plan_revision_id))).toContain('ai.setup.monthly')
    const after = await publish(raw)
    const second = await api('POST', `/catalog/releases/${after.id}/default-bundles`, { reason })
    expect(second.status, JSON.stringify(second.body)).toBe(200)
    const limits = await limitsOf(second.body.plan_revision_id)
    expect(limits).not.toHaveProperty('ai.setup.monthly')
    expect(limits['ai.assist.monthly']).toBe(100)
    // A limit the plan already set is kept as the owner left it.
    expect(limits).toHaveProperty('ai.messages.monthly')
  })
  it('needs both catalog and pricing rights and a reason, and answers 404 for an unknown release', async () => {
    const catalogOnly = client(pool, ['vendor.read', 'vendor.catalog.manage'])
    expect((await catalogOnly('POST', `/catalog/releases/${release.id}/default-bundles`, { reason })).status).toBe(403)
    expect((await api('POST', `/catalog/releases/${release.id}/default-bundles`, { reason: 'x' })).status).toBe(422)
    expect((await api('POST', '/catalog/releases/00000000-0000-4000-8000-00000000dead/default-bundles', { reason })).status).toBe(404)
    expect((await api('GET', `/catalog/releases/${release.id}/default-bundles`)).status).toBe(404)
  })
})
