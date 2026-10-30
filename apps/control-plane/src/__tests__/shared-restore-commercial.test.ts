import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool as PgPool } from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrate } from '../db.js'
import { publishOdooRestore, realRestoreHost } from '../shared/odoo-backup.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { businessKey, payloadDigest } from '../shared/provisioning.js'
import { runSubscriptionReconfigure } from '../shared/subscription-reconfigure.js'
import type { SharedRuntimeConfig } from '../shared/runtime-config.js'
import type { ObserveRunner } from '../shared/subscription-reconcile.js'
import type { Pool, PoolClient } from 'pg'
import type { SharedJob } from '@liwan/commercial-contracts/shared'
import * as backup from '../shared/shared-backup.js'
import { vendorAccount, replaceRoles } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const tenant = 'ad03d956-efef-4f80-baf3-9c23ea46e945'
const job: Extract<SharedJob, {operation:'restore'}> = {
  schemaVersion: 1, operation: 'restore', requestId: tenant, approvalId: tenant,
  binding: { tenantId: 'legacy', database: 'db_source', filestore: 'db_source', registryRevision: 1 },
  backup: { schemaVersion: 1, backupId: tenant, binding: { tenantId: 'legacy', database: 'db_source', filestore: 'db_source', registryRevision: 1 }, databaseSha256: 'a'.repeat(64), filestoreSha256: 'b'.repeat(64), consistency: 'verified' },
}

describe('commercial restore completion contract', () => {
  it('preserves approval-only finalization without changing legacy consumption', async () => {
    const client = { query: async (sql: string) => ({ rowCount: sql.startsWith('UPDATE shared_restore_approvals') ? 1 : 0, rows: sql.startsWith('UPDATE shared_restore_approvals') ? [{ id: tenant, target_database: 'db_target', control_tenant_id: tenant }] : [] }) } as unknown as PoolClient
    expect(await backup.finalizeVerifiedRestore(client, job, { issuer: 'restore-test', actorUid: 7 })).toBeUndefined()
  })

  it('provides a reusable gate for legacy tenants without observing commercial state', async () => {
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool
    expect(backup).toHaveProperty('commercialRestoreGate')
    expect(await backup.commercialRestoreGate(pool, { tenant_id: tenant })).toEqual({ ready: true })
  })
})

const source = process.env.CONTROL_TEST_DATABASE_URL
const url = source ? (() => { const u = new URL(source); if (!['localhost','127.0.0.1','::1'].includes(u.hostname)) throw Error('scratch_required'); u.pathname='/liwan_control_scratch_restorec'; return u.toString() })() : undefined

describe.skipIf(!url)('commercial restore publication (live PG, fake physical receipts)', () => {
  const pool = new PgPool({ connectionString: url, max: 10 })
  const issuer = vendorActorIssuer(`restore-commercial-${randomUUID()}`), actor = { issuer, actorUid: 7 }
  let root = '', runtime: SharedRuntimeConfig
  beforeAll(async () => {
    await migrate(pool)
    root = await realpath(await mkdtemp(join(tmpdir(), 'liwan-restore-commercial-')))
    runtime = { schemaVersion: 1, projectName: 'liwan-restore-commercial', composeFile: join(root,'compose.yml'), envFile: join(root,'env'), stateDir: root, domainSuffix: 'restore.invalid' }
    await vendorAccount(pool, ['customer_success', 'operations'], 7)
  })
  afterAll(async () => { await pool.end(); if (root) await rm(root, { recursive: true, force: true }) })

  async function fixture(commercial: boolean) {
    const tenant = randomUUID(), approval = randomUUID(), backupId = randomUUID(), customer = randomUUID(), subscription = randomUUID(), applied = randomUUID(), older = randomUUID(), order = randomUUID()
    const slug = `t${tenant.replaceAll('-','')}`, database = `liwan_scratch_${randomUUID().replaceAll('-','')}`, target = `liwan_scratch_${randomUUID().replaceAll('-','')}`
    const binding = { tenantId: slug, database, filestore: database, registryRevision: 1 }
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Restore fixture','saas','managed',$2,true)", [tenant, slug])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.invalid`, database])
    await pool.query("INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by) VALUES($1,$2,$3,$4,$4,'{}',$5,$6,'fixture','verified',$7)", [backupId,tenant,slug,database,'a'.repeat(64),'b'.repeat(64),issuer])
    await pool.query("INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at,consumed_at) VALUES($1,$2,$3,$4,'Restored fixture',now()+interval '1 hour',now())", [approval,backupId,tenant,target])
    const backupJob: SharedJob = {schemaVersion:1,operation:'backup',requestId:backupId,binding}
    const backupJobId = randomUUID()
    await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state) VALUES($1,$2,$3,$4,$5,$6,7,'Backup fixture','verified')", [backupJobId,tenant,businessKey(backupJob),backupJob,payloadDigest(backupJob),issuer])
    await pool.query("INSERT INTO shared_odoo_backups(backup_id,job_id,format,manifest_sha256,source_registry_revision) VALUES($1,$2,'odoo-pg-filestore-v1',$3,1)", [backupId,backupJobId,'d'.repeat(64)])
    await pool.query('INSERT INTO shared_odoo_restore_targets(approval_id,backup_id,control_tenant_id,target_database,source_binding,runtime_scope) VALUES($1,$2,$3,$4,$5,$6)', [approval,backupId,tenant,target,binding,runtime.projectName])
    const restored: SharedJob = { ...job, requestId: randomUUID(), approvalId: approval, binding, backup: { ...job.backup, backupId, binding } }
    const receipt = { schemaVersion:1,operation:'restore',binding,businessKey:businessKey(restored),payloadDigest:payloadDigest(restored),attemptId:randomUUID(),sequence:3,status:'verified' }
    await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state,receipt) VALUES($1,$2,$3,$4,$5,$6,7,'Verified restore fixture','verified',$7)", [randomUUID(),tenant,businessKey(restored),restored,payloadDigest(restored),issuer,receipt])
    if (commercial) {
      await pool.query("INSERT INTO customers(id,name,tenant_id) VALUES($1,'Paid fixture',$2)", [customer,tenant])
      await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)', [subscription,customer,tenant])
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,2,$3,$4)', [applied,subscription,{ entitlement: { modules:['liwan_platform'],features:{'users.limit':10},digest:'c'.repeat(64),compiler_version:'1' } },randomUUID()])
      await pool.query("UPDATE subscriptions SET applied_revision_id=$2,state='active',revision=revision+1 WHERE id=$1", [subscription,applied])
      await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'change',$4,$5,'paid','applied',$6,'fixture',100,'SAR',2)", [order,customer,subscription,randomUUID(),applied,randomUUID()])
    }
    const observe = async () => ({ state:'present',verified:true,binding,businessKey:businessKey(restored),payloadDigest:payloadDigest(restored) })
    let observed: Awaited<ReturnType<ObserveRunner>> = { commercial_revision_id:older,commercial_digest:'b'.repeat(64),branches:[] }
    const runner: ObserveRunner = async input => { expect(input.database).toBe(target); return observed }
    const reopen = () => publishOdooRestore(pool,runtime,actor,approval,observe,{runner})
    return { tenant,approval,subscription,applied,target,order,runner,reopen, current: () => { observed={commercial_revision_id:applied,commercial_digest:'c'.repeat(64),branches:[]} } }
  }

  it('legacy restore reopens with existing behavior and no reconfigure', async () => {
    const f = await fixture(false)
    expect(await f.reopen()).toMatchObject({ approvalId:f.approval,database:f.target })
    expect((await pool.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'", [f.tenant])).rows).toHaveLength(0)
  })

  it('older commercial target stays closed, enqueues once, then reopens after a current receipt', async () => {
    const f = await fixture(true)
    const path = join(root,'restore-registry','registry.json')
    for (let i=0;i<2;i++) await expect(f.reopen()).rejects.toMatchObject({code:'commercial_reconciliation_pending',status:409})
    const snapshot = JSON.parse(await readFile(path,'utf8'))
    expect(snapshot.targets.some((t: {database:string}) => t.database===f.target)).toBe(false)
    const queued = (await pool.query("SELECT id,payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'", [f.tenant])).rows
    expect(queued).toHaveLength(1)
    expect(queued[0].payload.binding.database).toBe(f.target)
    expect(queued[0].payload.authority.target_revision_id).toBe(f.applied)
    await runSubscriptionReconfigure(pool,queued[0].id,async ({job}) => {
      f.current()
      return { order_id:f.order,tenant_id:f.target,database:f.target,target_revision_id:f.applied,observed_entitlement_digest:'c'.repeat(64),observed_at:new Date().toISOString(),branch_bindings:[],modules_installed:[] }
    })
    expect(await f.reopen()).toMatchObject({database:f.target})
    expect((await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1',[f.subscription])).rows[0].applied_revision_id).toBe(f.applied)
    expect((await pool.query('SELECT id FROM invoices WHERE subscription_id=$1',[f.subscription])).rows).toHaveLength(0)
    expect((await pool.query('SELECT id FROM commercial_branches WHERE subscription_id=$1',[f.subscription])).rows).toHaveLength(0)
  })

  it('commercial restore fails closed when an observer is unavailable', async () => {
    const f = await fixture(true)
    expect(await backup.commercialRestoreGate(pool,{tenant_id:f.tenant,restore_id:f.approval,target:{database:f.target,filestore:f.target,host:realRestoreHost(f.approval,runtime.domainSuffix)}})).toMatchObject({ready:false,reason:'commercial_observer_unavailable'})
  })
})
