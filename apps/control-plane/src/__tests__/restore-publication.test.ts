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
import type { SharedJob } from '@webvue/commercial-contracts/shared'
import { requestRestorePublication, dispatchRestorePublication, restorePublication } from '../shared/restore-publication.js'
import { vendorAccount, replaceRoles } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const tenant = 'ad03d956-efef-4f80-baf3-9c23ea46e945'
const job: Extract<SharedJob, {operation:'restore'}> = {
  schemaVersion: 1, operation: 'restore', requestId: tenant, approvalId: tenant,
  binding: { tenantId: 'legacy', database: 'db_source', filestore: 'db_source', registryRevision: 1 },
  backup: { schemaVersion: 1, backupId: tenant, binding: { tenantId: 'legacy', database: 'db_source', filestore: 'db_source', registryRevision: 1 }, databaseSha256: 'a'.repeat(64), filestoreSha256: 'b'.repeat(64), consistency: 'verified' },
}

const source = process.env.CONTROL_TEST_DATABASE_URL
const url = source ? (() => { const u = new URL(source); if (!['localhost','127.0.0.1','::1'].includes(u.hostname)) throw Error('scratch_required'); if (!u.pathname.startsWith('/webvue_control_scratch_')) throw Error('scratch_required'); return u.toString() })() : undefined

describe.skipIf(!url)('durable publication (live PG, physical observation seam)', () => {
  const pool = new PgPool({ connectionString: url, max: 10 })
  const issuer = vendorActorIssuer(`restore-commercial-${randomUUID()}`), actor = { issuer, actorUid: 7 }
  let root = '', runtime: SharedRuntimeConfig
  beforeAll(async () => {
    await migrate(pool)
    root = await realpath(await mkdtemp(join(tmpdir(), 'webvue-restore-commercial-')))
    runtime = { schemaVersion: 1, projectName: 'webvue-restore-commercial-'+randomUUID().slice(0,8), composeFile: join(root,'compose.yml'), envFile: join(root,'env'), stateDir: root, domainSuffix: 'restore.invalid' }
    await vendorAccount(pool, ['customer_success', 'operations'], 7)
  })
  afterAll(async () => { await pool.end(); if (root) await rm(root, { recursive: true, force: true }) })

  async function fixture(commercial: boolean) {
    const tenant = randomUUID(), approval = randomUUID(), backupId = randomUUID(), customer = randomUUID(), subscription = randomUUID(), applied = randomUUID(), older = randomUUID(), order = randomUUID()
    const slug = `t${tenant.replaceAll('-','')}`, database = `webvue_scratch_${randomUUID().replaceAll('-','')}`, target = `webvue_scratch_${randomUUID().replaceAll('-','')}`
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
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,2,$3,$4)', [applied,subscription,{ entitlement: { modules:['webvue_platform'],features:{'users.limit':10},digest:'c'.repeat(64),compiler_version:'1' } },randomUUID()])
      await pool.query("UPDATE subscriptions SET applied_revision_id=$2,state='active',revision=revision+1 WHERE id=$1", [subscription,applied])
      await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'change',$4,$5,'paid','applied',$6,'fixture',100,'SAR',2)", [order,customer,subscription,randomUUID(),applied,randomUUID()])
    }
    const observe = async () => ({ state:'present',verified:true,binding,businessKey:businessKey(restored),payloadDigest:payloadDigest(restored) })
    let observed: Awaited<ReturnType<ObserveRunner>> = { commercial_revision_id:older,commercial_digest:'b'.repeat(64),branches:[] }
    const runner: ObserveRunner = async input => { expect(input.database).toBe(target); return observed }
    const reopen = () => publishOdooRestore(pool,runtime,actor,approval,observe,{runner})
    return { tenant,approval,subscription,applied,target,order,runner,reopen,observe, current: () => { observed={commercial_revision_id:applied,commercial_digest:'c'.repeat(64),branches:[]} } }
  }

  it('queues once, worker publishes and repeated dispatch does not repeat publication', async () => {
    const f = await fixture(false)
    for (let i=0;i<2;i++) expect(await requestRestorePublication(pool,runtime,actor,f.tenant,f.approval,'Restore confirmed')).toMatchObject({status:'queued'})
    expect((await pool.query('SELECT 1 FROM shared_restore_publications WHERE approval_id=$1',[f.approval])).rowCount).toBe(1)
    await dispatchRestorePublication(pool,runtime,{observe:f.observe})
    expect(await restorePublication(pool,f.tenant,f.approval)).toMatchObject({status:'published',host:realRestoreHost(f.approval,runtime.domainSuffix)})
    const registry = JSON.parse(await readFile(join(root,'restore-registry','registry.json'),'utf8'))
    expect(registry.targets.filter((t:{database:string})=>t.database===f.target)).toHaveLength(1)
    expect(await dispatchRestorePublication(pool,runtime,{observe:f.observe})).toEqual({state:'idle'})
  })
  it('wrong tenant cannot request or inspect an approval', async () => {
    const f = await fixture(false)
    await expect(requestRestorePublication(pool,runtime,actor,randomUUID(),f.approval,'Wrong tenant')).rejects.toThrow()
    await expect(restorePublication(pool,randomUUID(),f.approval)).rejects.toThrow()
    expect((await pool.query('SELECT 1 FROM shared_restore_publications WHERE approval_id=$1',[f.approval])).rowCount).toBe(0)
  })
  it('revocation between queue and dispatch prevents publication', async () => {
    const f = await fixture(false)
    await requestRestorePublication(pool,runtime,actor,f.tenant,f.approval,'Restore confirmed')
    await replaceRoles(pool,7,['customer_success'])
    try {
      await dispatchRestorePublication(pool,runtime,{observe:f.observe})
      expect(await restorePublication(pool,f.tenant,f.approval)).toMatchObject({status:'needs_intervention'})
    } finally { await replaceRoles(pool,7,['customer_success','operations']) }
  })
  it('changed physical observation stays closed with safe error, no automatic requeue', async () => {
    const f = await fixture(false)
    await requestRestorePublication(pool,runtime,actor,f.tenant,f.approval,'Restore confirmed')
    await dispatchRestorePublication(pool,runtime,{observe:async()=>({state:'unknown'})})
    expect(await restorePublication(pool,f.tenant,f.approval)).toMatchObject({status:'needs_intervention',code:'restore_publication_unverified'})
    expect(await requestRestorePublication(pool,runtime,actor,f.tenant,f.approval,'Retry request')).toMatchObject({status:'needs_intervention'})
  })
  it('a commercial reconciliation wait does not block another tenant publication', async () => {
    const waiting=await fixture(true), ready=await fixture(false)
    await requestRestorePublication(pool,runtime,actor,waiting.tenant,waiting.approval,'Waiting for policy')
    await requestRestorePublication(pool,runtime,actor,ready.tenant,ready.approval,'Restore confirmed')
    await dispatchRestorePublication(pool,runtime,{observe:job=>job.operation==='restore' && job.approvalId===waiting.approval?waiting.observe():ready.observe()},{runner:waiting.runner})
    expect(await restorePublication(pool,ready.tenant,ready.approval)).toMatchObject({status:'published'})
    expect(await restorePublication(pool,waiting.tenant,waiting.approval)).toMatchObject({status:'queued',code:'commercial_reconciliation_pending'})
  })

  it('keeps commercial publication queued without an isolated observer and never creates its route',async()=>{
    runtime={...runtime,projectName:runtime.projectName+'-gate'}
    const f=await fixture(true)
    await requestRestorePublication(pool,runtime,actor,f.tenant,f.approval,'Wait for isolated observer')
    await dispatchRestorePublication(pool,runtime,{observe:f.observe})
    expect(await restorePublication(pool,f.tenant,f.approval)).toMatchObject({status:'queued',code:'commercial_reconciliation_pending',host:null})
    const registry=JSON.parse(await readFile(join(root,'restore-registry','registry.json'),'utf8'))
    expect(registry.targets.some((t:{database:string})=>t.database===f.target)).toBe(false)
  })

})
