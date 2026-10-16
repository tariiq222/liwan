import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { signMock as signServiceRequest, mockSessionQuery } from './helpers/vendor-session.js'
import { createApp } from '../http.js'

const key = 'registry-http-synthetic-key-'.repeat(2)
const config = { installationId: 'registry-test', key, inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3' }
const seenNonces = new Set<string>()
const client = {
  async query(sql: string, params: unknown[] = []) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('DELETE FROM service_nonces')) return { rowCount: 0, rows: [] }
    if (sql.startsWith('INSERT INTO service_nonces')) {
      const nonceKey=JSON.stringify(params)
      if(seenNonces.has(nonceKey)) return {rowCount:0,rows:[]}
      seenNonces.add(nonceKey)
      return {rowCount:1,rows:[{nonce:params[1]}]}
    }
    const session = mockSessionQuery(sql, params)
    if (session) return session
    if (sql.startsWith('SELECT 1 FROM vendor_accounts WHERE id')) return { rowCount: 1, rows: [{}] }
    if (sql.startsWith('SELECT role FROM vendor_account_roles')) return { rowCount: 1, rows: [{ role: params[0] === 7 ? 'customer_success' : 'support' }] }
    throw new Error('unexpected SQL')
  },
  release() {},
}
const pool = { connect: async () => client } as unknown as Pool
const server = createApp(pool, config)
let origin: string
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })
async function call(path: string, actor = 7) {
  const body = '{}'
  return fetch(origin + path, { method: 'POST', body, headers: { ...signServiceRequest({ method: 'POST', path, body, actor, issuer: config.installationId, key }), 'content-type': 'application/json' } })
}
it.each(['/v1/registry/mutations', '/v1/registry/recover', '/v1/shared/tenants/ad03d956-efef-4f80-baf3-9c23ea46e945/jobs'])('rejects body tampering before executing %s', async path => {
  const headers = signServiceRequest({ method:'POST',path,body:'{}',actor:7,issuer:config.installationId,key })
  const result = await fetch(origin+path,{method:'POST',body:'{"reason":"tampered"}',headers:{...headers,'content-type':'application/json'}})
  expect(result.status).toBe(401)
})
it('rejects a signature transplanted from mutation to recovery', async () => {
  const body='{}', path='/v1/registry/mutations'
  const headers=signServiceRequest({method:'POST',path,body,actor:7,issuer:config.installationId,key})
  const response=await fetch(origin+'/v1/registry/recover',{method:'POST',body,headers:{...headers,'content-type':'application/json'}})
  expect(response.status).toBe(401)
})
it('rejects reuse of an already authenticated registry request nonce', async () => {
  const body='{}',path='/v1/registry/mutations'
  const headers={...signServiceRequest({method:'POST',path,body,actor:7,issuer:config.installationId,key}),'content-type':'application/json'}
  const first=await fetch(origin+path,{method:'POST',body,headers})
  expect(first.status).toBe(503)
  const replay=await fetch(origin+path,{method:'POST',body,headers})
  expect(replay.status).toBe(401)
})
it('requires operations authority before accepting a shared job', async () => {
  const result = await call('/v1/shared/tenants/ad03d956-efef-4f80-baf3-9c23ea46e945/jobs', 8)
  expect(result.status).toBe(403)
})
it.each(['/v1/registry/mutations', '/v1/registry/recover'])('requires management authority at %s', async path => {
  const result = await call(path, 8)
  expect(result.status).toBe(403)
  expect((await result.json()).code).toBe('forbidden')
})
it.each(['/v1/registry/mutations', '/v1/registry/recover'])('fails closed without operator publication path at %s', async path => {
  const result = await call(path)
  expect(result.status).toBe(503)
  expect((await result.json()).code).toBe('registry_unavailable')
})
