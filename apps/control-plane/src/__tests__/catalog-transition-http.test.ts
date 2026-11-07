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
 * A8: `/v1/catalog/:id/validate` and `/publish` refuse an entry whose source is not the current publishable catalog,
 * with the code `catalog-import` gives. An earlier catalog file still resolves by its bytes (published revisions are
 * pinned to it), so resolving the source is not enough: it must be the one publishable file.
 */
describe.skipIf(!url)('catalog validate and publish refuse a source that is not the publishable catalog', () => {
  const pool = new Pool({ connectionString: url })
  const config = { installationId: 'catalog-transition-test', key: 'synthetic-catalog-key-'.repeat(3), inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: repo, python: 'python3' }
  const server = createApp(pool, config)
  const created: string[] = []
  let origin: string, headers: (method: string, path: string, body?: string) => Record<string, string>

  async function entry(status: 'draft' | 'validated', sourceSha: string) {
    const id = randomUUID()
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,$3,$4,$5)', [id, `transition-${id}`, status, '{}', sourceSha])
    created.push(id)
    return id
  }
  async function transition(id: string, action: 'validate' | 'publish') {
    const path = `/v1/catalog/${id}/${action}`, body = JSON.stringify({ reason: 'Catalog transition test' })
    const response = await fetch(origin + path, { method: 'POST', body, headers: { ...headers('POST', path, body), 'content-type': 'application/json' } })
    return { status: response.status, body: await response.json() as { code?: string } }
  }
  const status = async (id: string) => (await pool.query('SELECT status FROM catalog_entries WHERE id=$1', [id])).rows[0].status

  beforeAll(async () => {
    await migrate(pool)
    headers = (await vendorSession(pool, config.installationId, ['owner'], { key: config.key })).headers
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No address')
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    if (created.length) await pool.query('DELETE FROM catalog_entries WHERE id = ANY($1::uuid[])', [created])
    await new Promise<void>(resolve => server.close(() => resolve())); await pool.end()
  })

  it('refuses to validate an entry stored from an earlier catalog file', async () => {
    const id = await entry('draft', sha('platform_v3.json'))
    expect(await transition(id, 'validate')).toMatchObject({ status: 409, body: { code: 'catalog_source_not_publishable' } })
    expect(await status(id)).toBe('draft')
  })

  it('refuses to publish an entry stored from an earlier catalog file', async () => {
    const id = await entry('validated', sha('platform_v3.json'))
    expect(await transition(id, 'publish')).toMatchObject({ status: 409, body: { code: 'catalog_source_not_publishable' } })
    expect(await status(id)).toBe('validated')
  })

  it('refuses an entry whose source bytes match no known catalog file', async () => {
    const id = await entry('validated', '0'.repeat(64))
    expect(await transition(id, 'publish')).toMatchObject({ status: 409, body: { code: 'catalog_source_not_publishable' } })
    expect(await status(id)).toBe('validated')
  })
})
