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
  it('starts every platform limit the release adds (the AI limits) unlimited on the new plan revision', async () => {
    const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform_v4.json', import.meta.url))
    const version = `commercial-${randomUUID()}`
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
    const platform = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const seeded = await api('POST', `/catalog/releases/${platform.id}/default-bundles`, { reason })
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200)
    const plan = (await pool.query('SELECT platform_limits FROM plan_revisions WHERE id=$1', [seeded.body.plan_revision_id])).rows[0]
    expect(plan.platform_limits).toEqual({ 'ai.messages.monthly': null, 'ai.tool_calls.per_run': null })
  })
  it('needs both catalog and pricing rights and a reason, and answers 404 for an unknown release', async () => {
    const catalogOnly = client(pool, ['vendor.read', 'vendor.catalog.manage'])
    expect((await catalogOnly('POST', `/catalog/releases/${release.id}/default-bundles`, { reason })).status).toBe(403)
    expect((await api('POST', `/catalog/releases/${release.id}/default-bundles`, { reason: 'x' })).status).toBe(422)
    expect((await api('POST', '/catalog/releases/00000000-0000-4000-8000-00000000dead/default-bundles', { reason })).status).toBe(404)
    expect((await api('GET', `/catalog/releases/${release.id}/default-bundles`)).status).toBe(404)
  })
})
