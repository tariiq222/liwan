// Live PostgreSQL on a loopback scratch database: the listing is a read projection, so it is tested against real rows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { migrate } from '../db.js'
import { listSharedBackups } from './backup-list.js'
import { vendorAccount } from '../__tests__/helpers/vendor-session.js'
const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) { const u = new URL(url); if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname) || !/^liwan_control_scratch_[a-z0-9]+$/.test(u.pathname.slice(1))) throw Error('isolated control test database required') }
const sha = (c: string) => c.repeat(64)

describe.skipIf(!url)('shared backup listing (live PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  type Fixture = { tenant: string; binding: Record<string, unknown> }
  async function workspace(options: { operations?: boolean } = {}): Promise<Fixture> {
    const tenant = randomUUID(), db = 'liwan_scratch_' + randomUUID().replaceAll('-', '')
    const binding = { tenantId: 't' + tenant.replaceAll('-', ''), database: db, filestore: db, registryRevision: 1 }
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Listing fixture','saas','shared_managed',$2,$3)", [tenant, 'fixture-' + tenant, options.operations ?? true])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, binding.tenantId, binding.tenantId + '.invalid', db])
    return { tenant, binding }
  }
  async function job(f: Fixture, operation: string, state: string, payload: Record<string, unknown> = {}) {
    const id = randomUUID(), body = { schemaVersion: 1, operation, requestId: randomUUID(), binding: f.binding, ...payload }
    await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state) VALUES($1,$2,$3,$4,$5,'vendor:x',7,'Fixture job',$6)", [id, f.tenant, 'k-' + id, body, sha('a'), state])
    return id
  }
  async function backup(f: Fixture, jobState = 'verified', createdBy = 'account:7') {
    const id = randomUUID(), jobId = await job(f, 'backup', jobState)
    await pool.query("INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by) VALUES($1,$2,$3,$4,$4,'{}',$5,$6,'/private/artifact/path','verified',$7)", [id, f.tenant, f.binding.tenantId, f.binding.database, sha('d'), sha('e'), createdBy])
    await pool.query("INSERT INTO shared_odoo_backups(backup_id,job_id,format,manifest_sha256,source_registry_revision) VALUES($1,$2,'odoo-pg-filestore-v1',$3,1)", [id, jobId, sha('f')])
    return { id, jobId }
  }
  async function approval(f: Fixture, backupId: string, options: { interval?: string; consumed?: boolean } = {}) {
    const id = randomUUID(), target = 'liwan_scratch_' + randomUUID().replaceAll('-', '')
    await pool.query("INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at,consumed_at) VALUES($1,$2,$3,$4,'Fixture approval',clock_timestamp()+$5::interval,CASE WHEN $6 THEN clock_timestamp() ELSE NULL END)", [id, backupId, f.tenant, target, options.interval ?? '1 hour', options.consumed ?? false])
    await pool.query("INSERT INTO shared_odoo_restore_targets(approval_id,backup_id,control_tenant_id,target_database,source_binding,runtime_scope) VALUES($1,$2,$3,$4,$5,'scope')", [id, backupId, f.tenant, target, f.binding])
    return id
  }
  beforeAll(async () => { await migrate(pool); await vendorAccount(pool, ['operations'], 7); await pool.query("UPDATE vendor_accounts SET display_name='Layla Operator' WHERE id=7") })
  afterAll(async () => { await pool.end() })

  it('returns nothing for an unknown workspace', async () => {
    expect(await listSharedBackups(pool, randomUUID())).toBeNull()
  })
  it('lists a verified backup with who started it, and nothing the browser does not need', async () => {
    const f = await workspace(), b = await backup(f)
    const list = (await listSharedBackups(pool, f.tenant))!
    expect(list.total).toBe(1)
    expect(list.items).toEqual([{ backup_id: b.id, job_id: b.jobId, created_at: expect.any(String), started_by: 'Layla Operator', approval: null, restores: [] }])
    const text = JSON.stringify(list)
    for (const secret of ['/private/artifact/path', sha('d'), sha('e'), sha('f'), String(f.binding.database), String(f.binding.tenantId)]) expect(text).not.toContain(secret)
  })
  it('answers an empty list with a start decision', async () => {
    const f = await workspace()
    expect(await listSharedBackups(pool, f.tenant)).toEqual({ start: { allowed: true, reason: null, job_id: null }, total: 0, items: [] })
  })
  it('never returns another workspace\'s backups, approvals or restores', async () => {
    const mine = await workspace(), other = await workspace()
    const own = await backup(mine), foreign = await backup(other)
    const foreignApproval = await approval(other, foreign.id)
    await job(other, 'restore', 'verified', { approvalId: foreignApproval })
    const list = (await listSharedBackups(pool, mine.tenant))!
    expect(list.items.map(i => i.backup_id)).toEqual([own.id])
    expect(list.items[0]!.approval).toBeNull(); expect(list.items[0]!.restores).toEqual([])
    expect(JSON.stringify(list)).not.toContain(foreign.id); expect(JSON.stringify(list)).not.toContain(foreignApproval)
  })
  it('excludes a backup whose job has not verified', async () => {
    const f = await workspace(); await backup(f, 'running')
    const list = (await listSharedBackups(pool, f.tenant))!
    expect(list.items).toEqual([]); expect(list.total).toBe(0)
  })
  it('shows an unexpired unused approval as usable, and an expired, consumed or already queued one as not', async () => {
    const f = await workspace()
    const usable = await backup(f), expired = await backup(f), consumed = await backup(f), queued = await backup(f)
    const approvalId = await approval(f, usable.id)
    await approval(f, expired.id, { interval: '-1 second' }); await approval(f, consumed.id, { consumed: true })
    await job(f, 'restore', 'queued', { approvalId: await approval(f, queued.id) })
    const byBackup = new Map((await listSharedBackups(pool, f.tenant))!.items.map(i => [i.backup_id, i]))
    expect(byBackup.get(usable.id)!.approval).toEqual({ approval_id: approvalId, expires_at: expect.any(String) })
    for (const other of [expired, consumed, queued]) expect(byBackup.get(other.id)!.approval).toBeNull()
  })
  it('lists the restore jobs made from a backup, newest first', async () => {
    const f = await workspace(), b = await backup(f)
    const first = await approval(f, b.id, { consumed: true }), second = await approval(f, b.id, { consumed: true })
    const firstJob = await job(f, 'restore', 'verified', { approvalId: first }), secondJob = await job(f, 'restore', 'needs_intervention', { approvalId: second })
    const restores = (await listSharedBackups(pool, f.tenant))!.items[0]!.restores
    expect(restores.map(r => [r.job_id, r.approval_id, r.state])).toEqual([[secondJob, second, 'needs_intervention'], [firstJob, first, 'verified']])
  })
  it('says a backup cannot be started while a job needs intervention, and names it', async () => {
    const f = await workspace(), stuck = await job(f, 'restore', 'needs_intervention')
    expect((await listSharedBackups(pool, f.tenant))!.start).toEqual({ allowed: false, reason: 'job_in_progress', job_id: stuck })
  })
  it('says a backup cannot be started while operations are off for the workspace', async () => {
    const f = await workspace({ operations: false })
    expect((await listSharedBackups(pool, f.tenant))!.start).toEqual({ allowed: false, reason: 'operations_unavailable', job_id: null })
  })
})
