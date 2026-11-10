import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { signMock as signServiceRequest, mockSessionQuery } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { requestSharedJobRecovery, UnsupportedRecoveryOperation } from '../shared/job-recovery.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'
vi.mock('../shared/job-recovery.js', async importOriginal => ({ ...(await importOriginal<typeof import('../shared/job-recovery.js')>()), requestSharedJobRecovery: vi.fn() }))
const key = 'shared-recover-http-synthetic-key-'.repeat(2)
const tenant = 'ad03d956-efef-4f80-baf3-9c23ea46e945'
const job = 'b68cb353-8e9b-4ad7-84a3-b634a8f346ca'
const path = `/v1/shared/tenants/${tenant}/jobs/${job}/recover`
const config = { installationId: 'recover-test', key, inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3', tenantRegistryPath: '/unused/registry.json' }
let roles = ['operations']; let fresh = true
const client = { release() {}, async query(sql: string, params: unknown[] = []) {
  const session = mockSessionQuery(sql, params); if (session) { if (sql.includes('FROM vendor_sessions') && !fresh) for (const row of session.rows) row.step_up_at = new Date(0); return session }
  if (sql.startsWith('SELECT 1 FROM vendor_accounts WHERE id')) return { rows: [{}], rowCount: 1 }
  if (sql.startsWith('SELECT role FROM vendor_account_roles')) return { rows: roles.map(role => ({ role })), rowCount: roles.length }
  if (sql.startsWith('INSERT INTO service_nonces')) return { rows: [{ nonce: 'fresh' }], rowCount: 1 }
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('DELETE FROM service_nonces')) return { rows: [], rowCount: 0 }
  throw Error('unexpected SQL:' + sql)
} }
const pool = { connect: async () => client } as unknown as Pool
const server = createApp(pool, config)
let origin: string
beforeAll(async () => {
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('missing address')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>(resolve => server.close(() => resolve())) })
beforeEach(() => { vi.mocked(requestSharedJobRecovery).mockReset(); roles = ['operations']; fresh = true; vi.stubEnv('LIWAN_TENANCY_MODE', 'shared') })
async function post(value: unknown) {
  const body = JSON.stringify(value)
  return fetch(origin + path, { method: 'POST', body, headers: { ...signServiceRequest({ method: 'POST', path, body, actor: 7, issuer: config.installationId, key }), 'content-type': 'application/json' } })
}

it.each([false, true])('forwards the signed operator and the reason, answering 202 or 200 on a replay (%s)', async replay => {
  const result = { job_id: job, state: 'pending', replay }
  vi.mocked(requestSharedJobRecovery).mockResolvedValue(result as never)
  const response = await post({ reason: 'Operator checked the worker host' })
  expect(response.status).toBe(replay ? 200 : 202)
  expect(await response.json()).toEqual(result)
  expect(requestSharedJobRecovery).toHaveBeenCalledWith(pool, tenant, job, { issuer: vendorActorIssuer('recover-test'), actorUid: 7 }, 'Operator checked the worker host')
})
it('answers 409 when the job cannot be recovered', async () => {
  vi.mocked(requestSharedJobRecovery).mockRejectedValue(new Error('shared_job_not_recoverable'))
  const response = await post({ reason: 'Operator checked the worker host' })
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('shared_job_not_recoverable')
})
it.each(['reconfigure', undefined])('answers 409 naming the unsupported operation (%s)', async operation => {
  vi.mocked(requestSharedJobRecovery).mockRejectedValue(new UnsupportedRecoveryOperation(operation))
  const response = await post({ reason: 'Operator checked the worker host' })
  expect(response.status).toBe(409)
  const body = await response.json()
  expect(body.code).toBe('shared_job_not_recoverable')
  expect(body.message).toContain(`'${operation ?? 'unknown'}'`)
})
it('answers 403 when the store refuses the operator', async () => {
  vi.mocked(requestSharedJobRecovery).mockRejectedValue(new Error('shared_job_forbidden'))
  expect((await post({ reason: 'Operator checked the worker host' })).status).toBe(403)
})
it('rejects a body that carries more than the reason', async () => {
  const response = await post({ reason: 'Operator checked the worker host', state: 'verified' })
  expect(response.status).toBe(422); expect(requestSharedJobRecovery).not.toHaveBeenCalled()
})
it('refuses an unsigned request', async () => {
  const response = await fetch(origin + path, { method: 'POST', body: JSON.stringify({ reason: 'Operator checked the worker host' }) })
  expect(response.status).toBe(401); expect(requestSharedJobRecovery).not.toHaveBeenCalled()
})
it.each([['customer_success'], ['support']])('needs the operations grant (%s)', async role => {
  roles = [role]
  expect((await post({ reason: 'Operator checked the worker host' })).status).toBe(403)
  expect(requestSharedJobRecovery).not.toHaveBeenCalled()
})
it('needs a fresh step-up', async () => {
  fresh = false
  const response = await post({ reason: 'Operator checked the worker host' })
  expect(response.status).toBe(403); expect((await response.json()).code).toBe('step_up_required')
  expect(requestSharedJobRecovery).not.toHaveBeenCalled()
})
it('is unavailable outside the shared runtime', async () => {
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  expect((await post({ reason: 'Operator checked the worker host' })).status).toBe(503)
  expect(requestSharedJobRecovery).not.toHaveBeenCalled()
})
