import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID, createHash } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('commercial catalog releases', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const api = client(pool)
  const reason = 'Test catalog release'
  let version: string, solution: any
  beforeAll(async () => { ({ version, solution } = await setup(pool)) })
  afterAll(async () => { await pool.end() })

  it('creates idempotently, persists across a new pool, and is immutable', async () => {
    const a = await api('POST', '/catalog/releases', { catalog_version: version, reason })
    expect(a.status).toBe(201)
    const b = await api('POST', '/catalog/releases', { catalog_version: version, reason })
    expect(b.status).toBe(200); expect(b.body).toEqual(a.body)
    const fresh = new Pool({ connectionString: url, max: 2 })
    try {
      const list = await client(fresh)('GET', '/catalog/releases')
      expect(list.body.items.find((r: any) => r.id === a.body.id)).toEqual(a.body)
    } finally { await fresh.end() }
    await expect(pool.query("UPDATE catalog_releases SET base_modules='[]' WHERE id=$1", [a.body.id])).rejects.toThrow('catalog_release_immutable')
  })
  it('a new catalog version does not change an older release; unpublished version is rejected', async () => {
    const before = (await api('GET', '/catalog/releases')).body.items.find((r: any) => r.version === version)
    const v2 = `commercial-${randomUUID()}`
    const changed = { ...solution, base_modules: [...(solution.base_modules ?? []), 'extra_mod'] }
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), v2, changed, createHash('sha256').update(v2).digest('hex')])
    const r2 = await api('POST', '/catalog/releases', { catalog_version: v2, reason })
    expect(r2.status).toBe(201); expect(r2.body.id).not.toBe(before.id); expect(r2.body.artifact_digest).not.toBe(before.artifact_digest)
    const after = (await api('GET', '/catalog/releases')).body.items.find((r: any) => r.version === version)
    expect(after).toEqual(before)
    const missing = await api('POST', '/catalog/releases', { catalog_version: 'nope-' + randomUUID(), reason })
    expect(missing.status).toBe(422)
    expect((await client(pool, ['vendor.read'])('POST', '/catalog/releases', { catalog_version: version, reason })).status).toBe(403)
  })
  it('two concurrent publishes yield one 200 and one 409', async () => {
    const rel = (await api('GET', '/catalog/releases')).body.items.find((r: any) => r.version === version)
    const app = rel.applications.find((a: any) => a.selectable && a.features.some((f: any) => f.selectable))
    const c = await api('POST', '/bundles', { name: `C ${randomUUID()}`, description: 'd', audience: { kind: 'public' }, catalog_release_id: rel.id,
      selections: [{ app_id: app.id, feature_keys: [app.features.find((f: any) => f.selectable).key] }], domain_limits: {}, prices: [{ cadence: monthly, amount: money(1) }] })
    const v = await api('POST', `/bundles/${c.body.id}/validate`, { edit_revision: 1, reason })
    const body = { edit_revision: v.body.edit_revision, reason }
    const results = await Promise.all([api('POST', `/bundles/${c.body.id}/publish`, body), api('POST', `/bundles/${c.body.id}/publish`, body)])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect(results.find(r => r.status === 409)!.body.code).toBe('revision_conflict')
  })
})
