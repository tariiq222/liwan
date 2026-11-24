import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApp } from '../http.js'
import { mockSessionQuery, signMock } from './helpers/vendor-session.js'

const tenant = '11111111-1111-4111-8111-111111111111'
const key = 'tenant-storage-route-synthetic-key-'.repeat(2), issuer = 'storage-route-test'

async function withServer(roles: string[], opts: { enabled?: boolean; asked?: boolean; notStored?: boolean }, run: (call: (method: string, body?: unknown) => Promise<Response>, sql: Array<[string, unknown[]]>) => Promise<void>) {
  const sql: Array<[string, unknown[]]> = []
  const result = (rows: unknown[] = [], rowCount = rows.length) => ({ rows, rowCount })
  const client = { release() {}, async query(text: string, params: unknown[] = []) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text) || text.startsWith('DELETE FROM service_nonces')) return result()
    if (text.startsWith('INSERT INTO service_nonces')) return result([{ nonce: params[1] }])
    const session = mockSessionQuery(text, params); if (session) return session
    if (text.includes('FROM vendor_accounts WHERE id')) return result([{}])
    if (text.includes('FROM vendor_account_roles')) return result(roles.map(role => ({ role })))
    if (text.startsWith('INSERT INTO audit_events')) { sql.push([text, params]); return result() }
    if (text.startsWith('SELECT 1 FROM shared_registry_bindings')) return result([], opts.asked === false ? 0 : 1)
    if (text.startsWith('UPDATE tenant_storage')) { sql.push([text, params]); return result([], opts.notStored ? 0 : 1) }
    if (text.includes('tenant_storage')) { sql.push([text, params]); return text.startsWith('INSERT') ? result([], opts.asked === false ? 0 : 1) : result([{ operation: 'rotate', state: 'pending_key' }]) }
    throw Error('unexpected_sql:' + text)
  } }
  const server = createApp({ connect: async () => client, query: client.query } as unknown as Pool,
    { installationId: issuer, key, ...(opts.enabled === false ? {} : { tenantStorageEnabled: true as const }), inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3' })
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('missing address')
    const path = `/v1/shared/tenants/${tenant}/storage`
    await run((method, body) => {
      const text = body === undefined ? '' : JSON.stringify(body)
      return fetch(`http://127.0.0.1:${address.port}${path}`, { method, ...(text ? { body: text } : {}), headers: { ...signMock({ method, path, body: text, actor: 7, issuer, key }), 'content-type': 'application/json' } })
    }, sql)
  } finally { vi.unstubAllEnvs(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
afterEach(() => vi.unstubAllEnvs())

describe('tenant storage routes', () => {
  it('an operator queues a rotation with a reason', async () => {
    await withServer(['operations'], {}, async (call, sql) => {
      const response = await call('POST', { operation: 'rotate', reason: 'Rotate the tenant key' })
      expect(response.status).toBe(202); expect(await response.json()).toEqual({ state: 'queued' })
      expect(sql[0]![1]).toEqual([tenant, 'rotate'])
      expect(sql[1]![1]!.slice(1)).toEqual(['account:7', 'tenant_storage.requested', tenant, 'rotate: Rotate the tenant key'])
    })
  })
  it('answers 409 tenant_storage_not_ready for a rotation of a tenant that never stored a key, and audits nothing', async () => {
    await withServer(['operations'], { notStored: true }, async (call, sql) => {
      const response = await call('POST', { operation: 'rotate', reason: 'Rotate the tenant key' })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'tenant_storage_not_ready' })
      expect(sql.some(([text]) => text.includes('audit_events'))).toBe(false)
    })
  })
  it('refuses a read-only role, a free operation name and an extra field, and does nothing', async () => {
    await withServer(['customer_success'], {}, async (call, sql) => {
      expect((await call('POST', { operation: 'rotate', reason: 'Rotate the tenant key' })).status).toBe(403)
      expect(sql).toHaveLength(0)
    })
    await withServer(['operations'], {}, async (call, sql) => {
      for (const body of [{ operation: 'drop', reason: 'Rotate the tenant key' }, { operation: 'verify', reason: 'Rotate the tenant key' }, { operation: 'rotate', reason: 'x' },
        { operation: 'rotate', reason: 'Rotate the tenant key', bucket: 'b' }]) expect((await call("POST", body)).status).toBe(422)
      expect(sql).toHaveLength(0)
    })
  })
  it('answers 409 for a tenant that is not ready and 503 while the feature is off', async () => {
    await withServer(['operations'], { asked: false }, async (call, sql) => {
      expect((await call('POST', { operation: 'ensure', reason: 'Try storage again' })).status).toBe(409)
      expect(sql.some(([text]) => text.includes('audit_events'))).toBe(false)
    })
    await withServer(['operations'], { enabled: false }, async (call, sql) => {
      expect((await call('POST', { operation: 'ensure', reason: 'Try storage again' })).status).toBe(503)
      expect((await call('GET')).status).toBe(503)
      expect(sql).toHaveLength(0)
    })
  })
  it('any role that can read the console may read the state, which holds no key or name', async () => {
    await withServer(['customer_success'], {}, async call => {
      const response = await call('GET')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ storage: { operation: 'rotate', state: 'pending_key' } })
    })
  })
})
