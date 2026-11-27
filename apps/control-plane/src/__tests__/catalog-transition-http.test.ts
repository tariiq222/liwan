import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vendorSession } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'

const repo = join(import.meta.dirname, '../../../..')
const sha = (name: string) => createHash('sha256').update(readFileSync(join(repo, 'deploy/catalog/solutions', name))).digest('hex')

/**
 * Import validates the catalog itself, so publish is the only manual transition and it re-runs the same check.
 * `/validate` is gone, a publish from a source that is not the one publishable catalog is refused, and a catalog
 * the check refuses stays `validated` with the row untouched.
 */
describe.skipIf(!url)('catalog publish is the only transition and re-checks the catalog', () => {
  const pool = new Pool({ connectionString: url })
  const config = { installationId: 'catalog-transition-test', key: 'synthetic-catalog-key-'.repeat(3), inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: repo, python: 'python3' }
  // The same app with an interpreter that cannot run the check: the repository check itself must refuse the publish.
  const brokenServer = createApp(pool, { ...config, python: '/nonexistent/python3' })
  const server = createApp(pool, config)
  const created: string[] = []
  let origin: string, brokenOrigin: string, headers: (method: string, path: string, body?: string) => Record<string, string>

  async function entry(status: 'draft' | 'validated', sourceSha: string) {
    const id = randomUUID()
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,$3,$4,$5)', [id, `transition-${id}`, status, '{}', sourceSha])
    created.push(id)
    return id
  }
  async function transition(base: string, id: string, action: string) {
    const path = `/v1/catalog/${id}/${action}`, body = JSON.stringify({ reason: 'Catalog transition test' })
    const response = await fetch(base + path, { method: 'POST', body, headers: { ...headers('POST', path, body), 'content-type': 'application/json' } })
    return { status: response.status, body: await response.json() as { code?: string, published_at?: string | null } }
  }
  const status = async (id: string) => (await pool.query('SELECT status,published_at FROM catalog_entries WHERE id=$1', [id])).rows[0] as { status: string, published_at: string | null }

  beforeAll(async () => {
    await migrate(pool)
    headers = (await vendorSession(pool, config.installationId, ['owner'], { key: config.key })).headers
    const listen = async (app: ReturnType<typeof createApp>) => {
      await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
      const address = app.address(); if (!address || typeof address === 'string') throw Error('No address')
      return `http://127.0.0.1:${address.port}`
    }
    origin = await listen(server)
    brokenOrigin = await listen(brokenServer)
  })
  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM audit_events WHERE subject = ANY($1::text[])', [created])
      await pool.query('DELETE FROM catalog_entries WHERE id = ANY($1::uuid[])', [created])
    }
    await new Promise<void>(resolve => server.close(() => resolve())); await new Promise<void>(resolve => brokenServer.close(() => resolve())); await pool.end()
  })

  it('no longer offers a validate transition', async () => {
    const id = await entry('draft', sha('platform_v5.json'))
    expect(await transition(origin, id, 'validate')).toMatchObject({ status: 404, body: { code: 'not_found' } })
    expect((await status(id)).status).toBe('draft')
  })

  it('refuses to publish an entry stored from an earlier catalog file', async () => {
    for (const earlier of ['platform_v3.json', 'platform_v4.json']) {
      const id = await entry('validated', sha(earlier))
      expect(await transition(origin, id, 'publish'), earlier).toMatchObject({ status: 409, body: { code: 'catalog_source_not_publishable' } })
      expect((await status(id)).status).toBe('validated')
    }
  })

  it('refuses an entry whose source bytes match no known catalog file', async () => {
    const id = await entry('validated', '0'.repeat(64))
    expect(await transition(origin, id, 'publish')).toMatchObject({ status: 409, body: { code: 'catalog_source_not_publishable' } })
    expect((await status(id)).status).toBe('validated')
  })

  it('refuses a publish whose repository check fails and leaves the row validated', async () => {
    const id = await entry('validated', sha('platform_v5.json'))
    expect(await transition(brokenOrigin, id, 'publish')).toMatchObject({ status: 422, body: { code: 'catalog_invalid' } })
    expect(await status(id)).toEqual({ status: 'validated', published_at: null })
  })

  it('publishes a validated entry, records published_at and resolves the import and publish actors', async () => {
    const id = await entry('validated', sha('platform_v5.json'))
    await pool.query("INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,'operator','catalog.imported',$2,'imported before the test')", [randomUUID(), id])
    const published = await transition(origin, id, 'publish')
    expect(published).toMatchObject({ status: 200, body: { status: 'published' } })
    expect(published.body.published_at).toEqual(expect.any(String))
    expect((await status(id)).status).toBe('published')

    const list = await fetch(origin + '/v1/catalog', { headers: headers('GET', '/v1/catalog') })
    const item = (await list.json() as { items: Array<{ id: string, published_at: string | null, imported_by: string | null, published_by: string | null }> }).items.find(row => row.id === id)
    expect(item).toMatchObject({ published_at: published.body.published_at, imported_by: 'operator', published_by: 'Test vendor' })
  })
})
