import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { scratchUrl, seedOrder, setupScratch } from './shared-subscription-reconfigure.test.js'
import { processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { runSubscriptionReconfigure, type SubscriptionRunner } from '../shared/subscription-reconfigure.js'
import { recoverInterrupted, reconcileAfterRestore, fakeObserveRunner } from '../shared/subscription-reconcile.js'

describe.skipIf(!scratchUrl)('subscription recovery integration-fake',()=>{
  const pool=new Pool({connectionString:scratchUrl})
  beforeAll(()=>setupScratch(pool));afterAll(()=>pool.end())
  it('crash after physical commit recovers the same operation receipt without duplicate effects',async()=>{
    const s=await seedOrder(pool);await processFulfillmentOutbox(pool,{limit:100})
    const job=(await pool.query('SELECT id,payload FROM shared_jobs WHERE control_tenant_id=$1',[s.tenant])).rows[0]
    const effects=new Map<string,unknown>();let mutations=0
    const runner:SubscriptionRunner=async input=>{
      await input.assertOwned()
      const op=input.job.authority.operation_id
      if(effects.has(op))return effects.get(op)
      mutations++;effects.set(op,s.receipt)
      await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id])
      throw Error('shared_lease_lost')
    }
    await expect(runSubscriptionReconfigure(pool,job.id,runner)).rejects.toThrow('shared_lease_lost')
    const recovered=await recoverInterrupted(pool,{runner})
    expect(recovered.find(r=>r.receipt?.order_id===s.order)?.receipt).toEqual(s.receipt)
    expect(mutations).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM fulfillment_effects WHERE order_id=$1',[s.order])).rows[0].n).toBe(1)
  },60000)
  it('restore observes approved target, queues one repair and only reports ready after readback',async()=>{
    const s=await seedOrder(pool);await processFulfillmentOutbox(pool,{limit:100})
    const job=(await pool.query('SELECT id FROM shared_jobs WHERE control_tenant_id=$1',[s.tenant])).rows[0]
    await runSubscriptionReconfigure(pool,job.id,async()=>s.receipt)
    const target={database:'webvue_scratch_restore_'+s.tenant.replaceAll('-','').slice(0,12),filestore:'',host:'restore.test'};target.filestore=target.database
    // A restore approval is mandatory; reuse the existing backup/approval authority shape.
    const backup=randomUUID(),restore=randomUUID()
    const binding=(await pool.query('SELECT * FROM shared_registry_bindings WHERE control_tenant_id=$1',[s.tenant])).rows[0]
    await pool.query("INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by) VALUES($1,$2,$3,$4,$4,'{}'::jsonb,$5,$5,'/tmp/fixture-backup','verified','integration-fake:7')",[backup,s.tenant,binding.tenant_id,binding.database_name,'c'.repeat(64)])
    await pool.query("INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,'integration fixture',now()+interval '1 hour')",[restore,backup,s.tenant,target.database])
    const observed=fakeObserveRunner({commercial_revision_id:s.previous,commercial_digest:'c'.repeat(64),branches:[]})
    const a=await reconcileAfterRestore(pool,{tenant_id:s.tenant,restore_id:restore,target,runner:observed})
    const b=await reconcileAfterRestore(pool,{tenant_id:s.tenant,restore_id:restore,target,runner:observed})
    expect(a.ready).toBe(false);expect(a.job_id).toBe(b.job_id)
    const repair=(await pool.query('SELECT payload FROM shared_jobs WHERE id=$1',[a.job_id])).rows[0]
    expect(repair.payload.binding.database).toBe(target.database)
    expect(await reconcileAfterRestore(pool,{tenant_id:s.tenant,restore_id:restore,target,runner:fakeObserveRunner({commercial_revision_id:s.target,commercial_digest:'a'.repeat(64),branches:[]})})).toEqual({ready:true})
  },60000)
})
