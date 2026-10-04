import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { url, setup, client, money, monthly } from './commercial-helpers.js'

const suite = url ? describe : describe.skip
suite('commercial bundles', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool)
  let release: any, selectable: { app: string; feature: string }
  const reason = 'Test bundle lifecycle'
  const body = (over: any = {}) => ({ name: `Bundle ${randomUUID()}`, description: 'd', audience: { kind: 'public' }, catalog_release_id: release.id,
    selections: [{ app_id: selectable.app, feature_keys: [selectable.feature] }], domain_limits: {}, prices: [{ cadence: monthly, amount: money(0) }], ...over })
  beforeAll(async () => {
    const { version } = await setup(pool)
    release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.selectable && a.features.some((f: any) => f.selectable))
    selectable = { app: app.id, feature: app.features.find((f: any) => f.selectable).key }
  })
  afterAll(async () => { await pool.end() })

  it('runs create → validate → publish → withdraw → restore → revisions', async () => {
    const c = await api('POST', '/bundles', body())
    expect(c.status).toBe(201)
    const id = c.body.id
    expect((await api('POST', `/bundles/${id}/publish`, { edit_revision: 1, reason })).status).toBe(409)
    const v = await api('POST', `/bundles/${id}/validate`, { edit_revision: 1, reason })
    expect(v.status).toBe(200); expect(v.body.status).toBe('validated'); expect(v.body.validated_digest).toBe(v.body.content_digest)
    const p = await api('POST', `/bundles/${id}/publish`, { edit_revision: v.body.edit_revision, reason })
    expect(p.body.status).toBe('published'); expect(p.body.available).toBe(true)
    const w = await api('POST', `/bundles/${id}/withdraw`, { edit_revision: p.body.edit_revision, reason })
    expect(w.body.available).toBe(false)
    const r = await api('POST', `/bundles/${id}/restore`, { edit_revision: w.body.edit_revision, reason })
    expect(r.body.available).toBe(true)
    const rev = await api('POST', `/bundles/${id}/revisions`, { edit_revision: r.body.edit_revision, reason })
    expect(rev.status).toBe(201); expect(rev.body.version).toBe(2); expect(rev.body.status).toBe('draft'); expect(rev.body.bundle_id).toBe(c.body.bundle_id)
    expect((await api('GET', `/bundles/${id}`)).body.status).toBe('published')
    const audits = await pool.query("SELECT count(*)::int n FROM audit_events WHERE subject=$1", [id])
    expect(audits.rows[0].n).toBe(5)
  })
  it('rejects stale revisions with 409 revision_conflict', async () => {
    const c = await api('POST', '/bundles', body())
    const ok = await api('PATCH', `/bundles/${c.body.id}`, { ...body({ name: 'Renamed' }), edit_revision: 1, reason })
    expect(ok.status).toBe(200); expect(ok.body.edit_revision).toBe(2)
    const stale = await api('PATCH', `/bundles/${c.body.id}`, { ...body(), edit_revision: 1, reason })
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('revision_conflict')
  })
  it('returns 422 with issues for an invalid selection', async () => {
    const c = await api('POST', '/bundles', body({ selections: [{ app_id: 'nonexistent', feature_keys: [] }] }))
    const v = await api('POST', `/bundles/${c.body.id}/validate`, { edit_revision: 1, reason })
    expect(v.status).toBe(422); expect(v.body.issues[0].code).toBe('unknown_app')
  })
  it('deletes only unreferenced drafts', async () => {
    const c = await api('POST', '/bundles', body())
    const ref = await api('POST', '/bundles', body())
    await pool.query("INSERT INTO revision_references(revision_id,revision_kind,referenced_by_kind,referenced_by_id) VALUES($1,'bundle','plan','x')", [ref.body.id])
    const blocked = await api('DELETE', `/bundles/${ref.body.id}`, { edit_revision: 1, reason })
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('bundle_delete_forbidden')
    expect((await api('DELETE', `/bundles/${c.body.id}`, { edit_revision: 1, reason })).status).toBe(200)
    expect((await api('GET', `/bundles/${c.body.id}`)).status).toBe(404)
    await expect(pool.query('DELETE FROM bundle_revisions WHERE id=$1', [ref.body.id])).rejects.toThrow('commercial_delete_forbidden')
  })
  it('hides private bundles from other customers and enforces capabilities', async () => {
    const c = await api('POST', '/bundles', body({ audience: { kind: 'customer', customer_id: 'cust-a' } }))
    expect((await api('GET', `/bundles/${c.body.id}?customer_id=cust-b`)).status).toBe(404)
    expect((await api('GET', `/bundles/${c.body.id}?customer_id=cust-a`)).status).toBe(200)
    const reader = client(pool, ['vendor.read'])
    expect((await reader('POST', '/bundles', body())).status).toBe(403)
    const catalogOnly = client(pool, ['vendor.read', 'vendor.catalog.manage'])
    const d = await api('POST', '/bundles', body())
    const v = await api('POST', `/bundles/${d.body.id}/validate`, { edit_revision: 1, reason })
    const denied = await catalogOnly('POST', `/bundles/${d.body.id}/publish`, { edit_revision: v.body.edit_revision, reason })
    expect(denied.status).toBe(403); expect(denied.body.code).toBe('forbidden')
  })
  it('lists with filters', async () => {
    const q = `uniq-${randomUUID()}`
    await api('POST', '/bundles', body({ name: q }))
    const l = await api('GET', `/bundles?status=draft&q=${q}&limit=5&offset=0`)
    expect(l.body.total).toBe(1); expect(l.body.items[0].name).toBe(q)
    expect((await api('GET', '/bundles?status=bogus')).status).toBe(422)
  })
})
