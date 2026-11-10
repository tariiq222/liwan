import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { signMock as signServiceRequest, mockSessionQuery } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { requestSharedJobAbandon, UnsupportedAbandonOperation } from '../shared/job-abandon.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'
vi.mock('../shared/job-abandon.js', async importOriginal => ({ ...(await importOriginal<typeof import('../shared/job-abandon.js')>()), requestSharedJobAbandon: vi.fn() }))
const key = 'shared-abandon-http-synthetic-key-'.repeat(2)
const tenant = 'ad03d956-efef-4f80-baf3-9c23ea46e945'
const job = 'b68cb353-8e9b-4ad7-84a3-b634a8f346ca'
const path = `/v1/shared/tenants/${tenant}/jobs/${job}/abandon`
const config = { installationId: 'abandon-test', key, inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3', tenantRegistryPath: '/unused/registry.json' }
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
beforeEach(() => { vi.mocked(requestSharedJobAbandon).mockReset(); roles = ['operations']; fresh = true; vi.stubEnv('LIWAN_TENANCY_MODE', 'shared') })
async function post(value: unknown) {
  const body = JSON.stringify(value)
  return fetch(origin + path, { method: 'POST', body, headers: { ...signServiceRequest({ method: 'POST', path, body, actor: 7, issuer: config.installationId, key }), 'content-type': 'application/json' } })
}

it.each([false, true])('forwards the signed operator and the reason, answering 202 or 200 on a replay (%s)', async replay => {
  const result = { job_id: job, state: 'pending', replay }
  vi.mocked(requestSharedJobAbandon).mockResolvedValue(result as never)
  const response = await post({ reason: 'Operator checked the worker host', confirm_job_id: job })
  expect(response.status).toBe(replay ? 200 : 202)
  expect(await response.json()).toEqual(result)
  expect(requestSharedJobAbandon).toHaveBeenCalledWith(pool, tenant, job, { issuer: vendorActorIssuer('abandon-test'), actorUid: 7 }, 'Operator checked the worker host')
})
it('answers 409 when the job cannot be recovered', async () => {
  vi.mocked(requestSharedJobAbandon).mockRejectedValue(new Error('shared_job_not_abandonable'))
  const response = await post({ reason: 'Operator checked the worker host', confirm_job_id: job })
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('shared_job_not_abandonable')
})
it.each(['provision', undefined])('answers 409 naming the unsupported operation (%s)', async operation => {
  vi.mocked(requestSharedJobAbandon).mockRejectedValue(new UnsupportedAbandonOperation(operation))
  const response = await post({ reason: 'Operator checked the worker host', confirm_job_id: job })
  expect(response.status).toBe(409)
  const body = await response.json()
  expect(body.code).toBe('shared_job_not_abandonable')
  expect(body.message).toContain(`'${operation ?? 'unknown'}'`)
})
it('answers 403 when the store refuses the operator', async () => {
  vi.mocked(requestSharedJobAbandon).mockRejectedValue(new Error('shared_job_forbidden'))
  expect((await post({ reason: 'Operator checked the worker host', confirm_job_id: job })).status).toBe(403)
})
it.each([randomUUID(), undefined])('refuses a confirmation that does not name this job (%s)', async confirm => {
  const response = await post({ reason: 'Operator checked the worker host', ...(confirm ? { confirm_job_id: confirm } : {}) })
  expect(response.status).toBe(422); expect(requestSharedJobAbandon).not.toHaveBeenCalled()
})
it('rejects a body that carries more than the reason', async () => {
  const response = await post({ reason: 'Operator checked the worker host', confirm_job_id: job, state: 'verified' })
  expect(response.status).toBe(422); expect(requestSharedJobAbandon).not.toHaveBeenCalled()
})
it('refuses an unsigned request', async () => {
  const response = await fetch(origin + path, { method: 'POST', body: JSON.stringify({ reason: 'Operator checked the worker host', confirm_job_id: job }) })
  expect(response.status).toBe(401); expect(requestSharedJobAbandon).not.toHaveBeenCalled()
})
it.each([['customer_success'], ['support']])('needs the operations grant (%s)', async role => {
  roles = [role]
  expect((await post({ reason: 'Operator checked the worker host', confirm_job_id: job })).status).toBe(403)
  expect(requestSharedJobAbandon).not.toHaveBeenCalled()
})
it('needs a fresh step-up', async () => {
  fresh = false
  const response = await post({ reason: 'Operator checked the worker host', confirm_job_id: job })
  expect(response.status).toBe(403); expect((await response.json()).code).toBe('step_up_required')
  expect(requestSharedJobAbandon).not.toHaveBeenCalled()
})
it('is unavailable outside the shared runtime', async () => {
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  expect((await post({ reason: 'Operator checked the worker host', confirm_job_id: job })).status).toBe(503)
  expect(requestSharedJobAbandon).not.toHaveBeenCalled()
})
