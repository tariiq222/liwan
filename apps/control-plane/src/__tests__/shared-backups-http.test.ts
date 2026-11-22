import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { signMock as signServiceRequest, mockSessionQuery } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { listSharedBackups } from '../shared/backup-list.js'
import { approveOdooRestore } from '../shared/odoo-backup.js'
vi.mock('../shared/backup-list.js', () => ({ listSharedBackups: vi.fn() }))
vi.mock('../shared/odoo-backup.js', () => ({ approveOdooRestore: vi.fn(), odooJobProgress: vi.fn() }))
vi.mock('../shared/runtime-config.js', () => ({ loadSharedRuntimeConfig: vi.fn(() => ({ projectName: 'runtime' })) }))
const key = 'shared-backups-http-synthetic-key-'.repeat(2)
const tenant = 'ad03d956-efef-4f80-baf3-9c23ea46e945'
const path = `/v1/shared/tenants/${tenant}/backups`
const config = { installationId: 'backups-test', key, inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3', tenantRegistryPath: '/unused/registry.json', sharedRuntimeConfigPath: '/unused/runtime.json' }
let roles = ['support']
const client = { release() {}, async query(sql: string, params: unknown[] = []) {
  const session = mockSessionQuery(sql, params); if (session) return session
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('missing address')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>(resolve => server.close(() => resolve())) })
beforeEach(() => { vi.mocked(listSharedBackups).mockReset(); vi.mocked(approveOdooRestore).mockReset(); roles = ['support']; vi.stubEnv('LIWAN_TENANCY_MODE', 'shared') })
function request(method: string, signedPath = path) {
  return fetch(origin + path, { method, headers: signServiceRequest({ method, path: signedPath, body: '', actor: 7, issuer: config.installationId, key }) })
}

it('answers a reader with the listing of that one workspace', async () => {
  const listing = { start: { allowed: true, reason: null, job_id: null }, total: 0, items: [] }
  vi.mocked(listSharedBackups).mockResolvedValue(listing)
  const response = await request('GET')
  expect(response.status).toBe(200); expect(await response.json()).toEqual(listing)
  expect(listSharedBackups).toHaveBeenCalledWith(pool, tenant)
})
it('answers 404 for a workspace that does not exist', async () => {
  vi.mocked(listSharedBackups).mockResolvedValue(null)
  const response = await request('GET')
  expect(response.status).toBe(404); expect((await response.json()).code).toBe('not_found')
})
it('answers 503 outside shared mode, before reading anything', async () => {
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  const response = await request('GET')
  expect(response.status).toBe(503); expect((await response.json()).code).toBe('shared_execution_unavailable')
  expect(listSharedBackups).not.toHaveBeenCalled()
})
it('refuses an unsigned request', async () => {
  expect((await fetch(origin + path)).status).toBe(401); expect(listSharedBackups).not.toHaveBeenCalled()
})
it('refuses an account with no vendor role', async () => {
  roles = []
  expect((await request('GET')).status).toBe(403); expect(listSharedBackups).not.toHaveBeenCalled()
})
it('accepts only GET', async () => {
  expect((await request('POST')).status).toBe(404); expect(listSharedBackups).not.toHaveBeenCalled()
})

const approvalPath = `/v1/shared/tenants/${tenant}/restore-approvals`
function approve() {
  const body = JSON.stringify({ backup_id: 'ad03d956-efef-4f80-baf3-9c23ea46e946', reason: 'Restore check' })
  return fetch(origin + approvalPath, { method: 'POST', body, headers: { ...signServiceRequest({ method: 'POST', path: approvalPath, body, actor: 7, issuer: config.installationId, key }), 'content-type': 'application/json' } })
}
it('answers an approval with its id and expiry only', async () => {
  roles = ['operations']
  const approval = { approval_id: randomUUID(), expires_at: '2026-11-22T11:00:00.000Z' }
  vi.mocked(approveOdooRestore).mockResolvedValue(approval)
  const response = await approve()
  expect(response.status).toBe(201); expect(await response.json()).toEqual(approval)
})
it('never answers an approval that carries more than its id and expiry', async () => {
  roles = ['operations']
  vi.mocked(approveOdooRestore).mockResolvedValue({ approval_id: 'ad03d956-efef-4f80-baf3-9c23ea46e947', expires_at: '2026-11-22T11:00:00.000Z', target_database: 'liwan_scratch_x' } as never)
  const response = await approve()
  expect(response.status).not.toBe(201); expect(JSON.stringify(await response.json())).not.toContain('liwan_scratch_x')
})
