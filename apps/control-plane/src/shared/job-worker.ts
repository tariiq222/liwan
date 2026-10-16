import { commercialEnrollmentActor, commercialProvisionAuthoritySql } from './commercial-enrollment-authority.js'
import type { Config } from '../config.js'
import { resolvePackageJobAuthorityInTransaction } from '../packages.js'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import type { SharedJob } from '@webvue/commercial-contracts/shared'
import { transaction } from '../db.js'
import { resolveProvisionTarget } from './onboarding.js'
import { requireJobAuthority } from './job-store.js'
import { bindJob, businessKey, payloadDigest, reconcileSharedJob, verifiedReceipt } from './provisioning.js'
import { commercialRestoreGate, finalizeVerifiedRestore } from './shared-backup.js'
import { runSubscriptionReconfigure, type SubscriptionAdapter } from './subscription-reconfigure.js'
import { actorLabel } from '../admin-auth/grants.js'

/** The physical adapter must atomically enforce fence validity at each mutation.
 * A caller-provided callback or a preflight lease check alone is NOT sufficient.
 * No production adapter is configured by default. */
export interface SharedFencedAdapter extends SubscriptionAdapter {
  observe(job: SharedJob): Promise<unknown>
  applyFenced(input: { job: SharedJob; attemptId: string; fence: number; assertOwned: () => Promise<void> }): Promise<void>
}
async function requireWorkerAuthority(client: PoolClient, row: Record<string, any>) {
  const actor = { issuer: row.issuer as string, actorUid: Number(row.actor_uid) }
  if (row.payload?.operation !== 'provision' || !actor.issuer.endsWith(':commercial-fulfillment')) {
    return requireJobAuthority(client, row.control_tenant_id, actor)
  }
  const valid = await client.query(`SELECT queued.id FROM shared_jobs queued WHERE queued.id=$1 AND (${commercialProvisionAuthoritySql()})`, [row.id])
  if (!valid.rowCount) throw Error('enrollment_authority_invalid')
  // Reconstitute an object capability only in this trusted worker. The authority
  // module locks the same paid commercial records before claim/every fenced step.
  const service = commercialEnrollmentActor({ installationId: actor.issuer.slice(0, -':commercial-fulfillment'.length) } as Config, row.payload.requestId)
  try { await requireJobAuthority(client, row.control_tenant_id, service) }
  catch (error) {
    if (error instanceof Error && error.message === 'commercial_enrollment_forbidden') throw Error('enrollment_authority_invalid')
    throw error
  }
}
async function quarantineEnrollment(client: PoolClient, id: string) {
  await client.query("UPDATE shared_jobs SET state='needs_intervention',lease_until=NULL WHERE id=$1", [id])
  await client.query("INSERT INTO audit_events(id,actor,action,subject,reason) VALUES(gen_random_uuid(),'shared-worker','shared_job.enrollment_authority_invalid',$1,'enrollment_authority_invalid')", [id])
}
function nextSequence(sequence: number): number {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= Number.MAX_SAFE_INTEGER) throw new Error('shared_sequence_invalid')
  return sequence + 1
}
export async function expireSharedLeases(pool: Pool): Promise<number> {
  // The transition and its audit succeed or roll back together. Preserve the
  // last intent journal so read-only recovery can reconcile a crashed effect.
  const result = await pool.query(`WITH expired AS (
    UPDATE shared_jobs SET state='needs_intervention',fence=fence+1,lease_until=NULL
    WHERE state='running' AND lease_until<=clock_timestamp()
    RETURNING id,attempt_id,fence
  ) INSERT INTO audit_events(id,actor,action,subject,reason)
    SELECT gen_random_uuid(),'shared-worker','shared_job.lease_expired',id::text,
      'Lease expired; quarantined attempt ' || attempt_id::text || ' at fence ' || fence::text
    FROM expired`)
  return result.rowCount ?? 0
}
export async function recoverSharedJob(pool: Pool, id: string, actor: { issuer: string; actorUid: number }, reason: string, adapter?: SharedFencedAdapter) {
  if (!adapter) throw new Error('shared_adapter_unavailable')
  z.uuid().parse(id); z.string().trim().min(3).max(1000).parse(reason)
  const inspect = async (client: PoolClient) => {
    const result = await client.query("SELECT * FROM shared_jobs WHERE id=$1 AND state='needs_intervention' FOR UPDATE", [id])
    if (!result.rowCount) throw new Error('shared_job_not_recoverable')
    const row = result.rows[0]
    await requireJobAuthority(client,row.control_tenant_id,actor)
    const fence = Number(row.fence)
    if (!Number.isSafeInteger(fence) || fence < 0) throw new Error('shared_fence_invalid')
    const job = bindJob(row.payload)
    // Recovery reconciles from observation only: a started journal finalizes
    // exact existing effects and never consumes a second approval.
    if (row.business_key !== businessKey(job) || row.payload_digest !== payloadDigest(job)) throw new Error('shared_job_identity_corrupt')
    if (row.journal && row.journal.attemptId !== row.attempt_id) throw new Error('shared_job_identity_corrupt')
    await resolvePackageJobAuthorityInTransaction(client,job)
    const target = await resolveProvisionTarget(client,row.control_tenant_id,job)
    reconcileSharedJob(job,target,row.journal,{state:'unknown'})
    return { row, job, target, fence }
  }
  const before = await transaction(pool, inspect)
  const observation = await adapter.observe(before.job)
  const preliminary = reconcileSharedJob(before.job,before.target,before.row.journal,observation)
  const fresh = ['record_verified','replay_verified'].includes(preliminary.action)
    ? await adapter.observe(before.job) : observation
  return transaction(pool, async client => {
    const { row, job, target, fence } = await inspect(client)
    if (row.attempt_id !== before.row.attempt_id || fence !== before.fence ||
        JSON.stringify(row.journal) !== JSON.stringify(before.row.journal)) throw new Error('shared_lease_lost')
    // Sticky intervention journal is deliberately not erased by recovery. An
    // expired started journal can finalize exact existing effects, never execute.
    const decision = reconcileSharedJob(job,target,row.journal,observation)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),actorLabel(actor),'shared_job.recovery_observed',id,reason])
    if (!['record_verified','replay_verified'].includes(decision.action)) return { state:'needs_intervention' }
    const journal = { ...row.journal,sequence:nextSequence(row.journal.sequence),stage:'verified' }
    const receipt = verifiedReceipt(job,target,journal,fresh)
    await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,journal.attemptId,fence,journal.sequence,'verified',{observation:fresh,receipt,recoveredBy:actor}])
    // A restore whose effect committed while the authority lost its control
    // transaction is consumed here, exactly once, with the job receipt.
    await finalizeVerifiedRestore(client,job,{ issuer: row.issuer, actorUid: Number(row.actor_uid) })
    const updated = await client.query("UPDATE shared_jobs SET journal=$1,receipt=$2,state='verified',lease_until=NULL WHERE id=$3 AND fence=$4 AND state='needs_intervention' RETURNING id", [journal,receipt,id,fence])
    if (!updated.rowCount) throw new Error('shared_lease_lost')
    return { state:'verified',receipt }
  })
}
const MAX_WRITER_RETRIES = 20
export async function runSharedJob(pool: Pool, id: string, adapter?: SharedFencedAdapter) {
  if (!adapter) throw new Error('shared_adapter_unavailable')
  z.uuid().parse(id)
  // Preflight only on the subscription-capable path; legacy adapters (no
  // subscriptionRunner/observeSubscription) never see this extra query.
  const subscriptionCapable=Boolean(adapter.subscriptionRunner || adapter.observeSubscription)
  const kind=subscriptionCapable?await pool.query("SELECT payload->>'operation' AS operation,* FROM shared_jobs WHERE id=$1",[id]):{rows:[] as any[]}
  if(kind.rows[0]?.operation==='reconfigure')return runSubscriptionReconfigure(pool,id,adapter.subscriptionRunner)
  if(kind.rows[0]?.journal?.stage==='waiting_commercial_reconcile'){
    const row=kind.rows[0],job=bindJob(row.payload)
    if(job.operation!=='restore' || row.state!=='queued')throw Error('shared_job_not_claimable')
    const target=await pool.query('SELECT target_database FROM shared_restore_approvals WHERE id=$1',[job.approvalId])
    const gate=await commercialRestoreGate(pool,{tenant_id:row.control_tenant_id,restore_id:job.approvalId,target:{database:target.rows[0].target_database,filestore:target.rows[0].target_database,host:job.binding.tenantId+'.restore'},runner:adapter.observeSubscription})
    if(gate.ready){
      // Effect and receipt were stored when the job was requeued; never re-claim or re-execute.
      await pool.query("UPDATE shared_jobs SET state='verified',journal=jsonb_set(journal,'{stage}','\"verified\"'),lease_until=NULL WHERE id=$1 AND state='queued' AND receipt IS NOT NULL",[id])
      return {state:'verified',receipt:row.receipt}
    }
    {
    const failed=gate.job_id?await pool.query("SELECT 1 FROM shared_jobs WHERE id=$1 AND state='needs_intervention'",[gate.job_id]):null
    if(failed?.rowCount){await pool.query("UPDATE shared_jobs SET state='needs_intervention' WHERE id=$1 AND state='queued'",[id]);return {state:'needs_intervention',reason:'commercial_reconcile_failed'}}
    return {state:'waiting_commercial_reconcile'}
    }
  }
  const claim = await transaction(pool, async client => {
    const result = await client.query("SELECT * FROM shared_jobs WHERE id=$1 AND state='queued' AND (lease_until IS NULL OR lease_until<=clock_timestamp()) FOR UPDATE", [id])
    if (!result.rowCount) throw new Error('shared_job_not_claimable')
    const row = result.rows[0]
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [row.control_tenant_id])
    const unresolved = await client.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND id<>$2 AND state IN ('running','needs_intervention') LIMIT 1", [row.control_tenant_id,id])
    if (unresolved.rowCount) throw new Error('shared_reconciliation_required')
    try { await requireWorkerAuthority(client, row) }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'enrollment_authority_invalid') throw error
      await quarantineEnrollment(client, id)
      return null
    }
    const job = bindJob(row.payload)
    if (row.business_key !== businessKey(job) || row.payload_digest !== payloadDigest(job)) throw new Error('shared_job_identity_corrupt')
    await resolvePackageJobAuthorityInTransaction(client,job)
    const target = await resolveProvisionTarget(client,row.control_tenant_id,job)
    reconcileSharedJob(job,target,row.journal ?? null,{ state:'unknown' })
    const previousFence = Number(row.fence)
    if (!Number.isSafeInteger(previousFence) || previousFence < 0 || previousFence >= Number.MAX_SAFE_INTEGER) throw new Error('shared_fence_invalid')
    const attemptId = randomUUID(), fence = previousFence + 1
    await client.query("UPDATE shared_jobs SET state='running',attempt_id=$1,fence=$2,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$3", [attemptId,fence,id])
    return { row,job,attemptId,fence }
  })
  if (!claim) return { state: 'needs_intervention', reason: 'enrollment_authority_invalid' }
  const owned = async <T>(action: (client: PoolClient, row: Record<string, any>) => Promise<T>) => transaction(pool, async client => {
    const current = await client.query("SELECT * FROM shared_jobs WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE", [id,claim.attemptId,claim.fence])
    if (!current.rowCount) throw new Error('shared_lease_lost')
    await requireWorkerAuthority(client, current.rows[0])
    await resolvePackageJobAuthorityInTransaction(client,claim.job)
    const target = await resolveProvisionTarget(client,claim.row.control_tenant_id,claim.job)
    reconcileSharedJob(claim.job,target,current.rows[0].journal,{state:'unknown'})
    return action(client,current.rows[0])
  })
  const assertOwned = () => owned(async client => {
    await client.query("UPDATE shared_jobs SET lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp()", [id,claim.attemptId,claim.fence])
  })
  const append = async (stage: 'prepared'|'started'|'verified'|'needs_intervention', observation: unknown) => owned(async (client,row) => {
    const journal = { schemaVersion:1,job:claim.job,attemptId:claim.attemptId,sequence:nextSequence(row.journal?.sequence ?? 0),stage }
    await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,claim.attemptId,claim.fence,journal.sequence,stage,{observation}])
    const updated = await client.query("UPDATE shared_jobs SET journal=$1 WHERE id=$2 AND attempt_id=$3 AND fence=$4 AND state='running' AND lease_until>clock_timestamp() RETURNING id", [journal,id,claim.attemptId,claim.fence])
    if (!updated.rowCount) throw new Error('shared_lease_lost')
    if (stage === 'needs_intervention') await client.query("UPDATE shared_jobs SET state='needs_intervention',lease_until=NULL WHERE id=$1", [id])
    return journal
  })
  let journal = claim.row.journal ?? null
  // Set only when adapter.applyFenced itself refused before the runtime gate: no effect ran.
  let fencedRefusal = null as { observation: unknown } | null
  try {
    await assertOwned()
    let observation = await adapter.observe(claim.job)
    const target = await transaction(pool, client => resolveProvisionTarget(client,claim.row.control_tenant_id,claim.job))
    let decision = reconcileSharedJob(claim.job,target,journal,observation)
    if (decision.action === 'persist_intent') {
      journal = await append('prepared',observation)
      decision = reconcileSharedJob(claim.job,target,journal,observation)
    }
    if (decision.action === 'execute') {
      journal = await append('started',observation)
      await assertOwned()
      try { await adapter.applyFenced({job:claim.job,attemptId:claim.attemptId,fence:claim.fence,assertOwned}) }
      catch (applyError) {
        if (applyError instanceof Error && applyError.message === 'runtime_writer_present') fencedRefusal = { observation }
        throw applyError
      }
      await assertOwned()
      observation = await adapter.observe(claim.job)
      const freshTarget = await transaction(pool, client => resolveProvisionTarget(client,claim.row.control_tenant_id,claim.job))
      decision = reconcileSharedJob(claim.job,freshTarget,journal,observation)
    }
    if (decision.action !== 'record_verified' && decision.action !== 'replay_verified') {
      await append('needs_intervention',observation)
      return { state:'needs_intervention' }
    }
    // External readback must not hold control-plane locks. Revalidate current
    // ownership, authority and binding in the short final transaction below.
    await assertOwned()
    observation = await adapter.observe(claim.job)
    const actor = { issuer: claim.row.issuer, actorUid: Number(claim.row.actor_uid) }
    if (subscriptionCapable && claim.job.operation === 'restore') {
      // Approval consumption + audit commit first (idempotent); the commercial
      // gate then runs outside any transaction, BEFORE the job is verified.
      await owned(client => finalizeVerifiedRestore(client,claim.job,actor))
      const approval = await pool.query('SELECT target_database FROM shared_restore_approvals WHERE id=$1',[claim.job.approvalId])
      const database = approval.rows[0]?.target_database
      const gate = database ? await commercialRestoreGate(pool,{tenant_id:claim.row.control_tenant_id,restore_id:claim.job.approvalId,target:{database,filestore:database,host:claim.job.binding.tenantId+'.restore'},runner:adapter.observeSubscription}) : { ready:true }
      if (!gate.ready) {
        await owned(async (client,row) => {
          // Store the receipt (non-final: state stays queued) so the re-claim
          // only flips state; the restore effect is never re-executed.
          const verified = { schemaVersion:1,job:claim.job,attemptId:claim.attemptId,sequence:nextSequence(row.journal?.sequence ?? 0),stage:'verified' }
          const currentTarget = await resolveProvisionTarget(client,claim.row.control_tenant_id,claim.job)
          const receipt = verifiedReceipt(claim.job,currentTarget,verified,observation)
          await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,claim.attemptId,claim.fence,verified.sequence,'verified',{observation,receipt}])
          const updated = await client.query("UPDATE shared_jobs SET state='queued',journal=$1,receipt=$2,lease_until=NULL WHERE id=$3 AND attempt_id=$4 AND fence=$5 AND state='running' AND lease_until>clock_timestamp() RETURNING id",[{...verified,stage:'waiting_commercial_reconcile'},receipt,id,claim.attemptId,claim.fence])
          if (!updated.rowCount) throw new Error('shared_lease_lost')
        })
        return { state:'waiting_commercial_reconcile' }
      }
      await assertOwned()
      observation = await adapter.observe(claim.job)
    }
    return await owned(async (client,row) => {
      const verified = { schemaVersion:1,job:claim.job,attemptId:claim.attemptId,sequence:nextSequence(row.journal?.sequence ?? 0),stage:'verified' }
      const currentTarget = await resolveProvisionTarget(client,claim.row.control_tenant_id,claim.job)
      const receipt = verifiedReceipt(claim.job,currentTarget,verified,observation)
      await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,claim.attemptId,claim.fence,verified.sequence,'verified',{observation,receipt}])
      await finalizeVerifiedRestore(client,claim.job,actor)
      const updated = await client.query("UPDATE shared_jobs SET journal=$1,receipt=$2,state='verified',lease_until=NULL WHERE id=$3 AND attempt_id=$4 AND fence=$5 AND state='running' AND lease_until>clock_timestamp() RETURNING id", [verified,receipt,id,claim.attemptId,claim.fence])
      if (!updated.rowCount) throw new Error('shared_lease_lost')
      return { state:'verified',receipt }
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'enrollment_authority_invalid') {
      await transaction(pool, async client => {
        const current = await client.query("SELECT id FROM shared_jobs WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' FOR UPDATE", [id, claim.attemptId, claim.fence])
        if (current.rowCount) await quarantineEnrollment(client, id)
      })
      return { state: 'needs_intervention', reason: 'enrollment_authority_invalid' }
    }
    // runtime_writer_present from applyFenced is refused before the runtime gate is taken, so no
    // effect ran. Return the job to queued at its prepared journal with a backoff, up to a cap.
    // The same code from any other call (observe, finalize) takes the normal path below.
    if (fencedRefusal && error instanceof Error) {
      try {
        const retries = Number((await transaction(pool, client => client.query("SELECT count(*) AS n FROM shared_job_events WHERE job_id=$1 AND evidence->>'retry'='runtime_writer_present'", [id]))).rows[0]?.n ?? 0)
        if (retries >= MAX_WRITER_RETRIES) {
          await append('needs_intervention',fencedRefusal.observation)
          console.error(`[shared-worker] job ${id} quarantined after ${retries} runtime_writer_present retries`)
          return { state:'needs_intervention', reason:'runtime_writer_contended' }
        }
        await owned(async (client,row) => {
          const requeued = { schemaVersion:1,job:claim.job,attemptId:claim.attemptId,sequence:nextSequence(row.journal?.sequence ?? 0),stage:'prepared' }
          await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,claim.attemptId,claim.fence,requeued.sequence,'prepared',{observation:fencedRefusal!.observation,retry:'runtime_writer_present'}])
          const updated = await client.query("UPDATE shared_jobs SET state='queued',journal=$1,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$2 AND attempt_id=$3 AND fence=$4 AND state='running' AND lease_until>clock_timestamp() RETURNING id", [requeued,id,claim.attemptId,claim.fence])
          if (!updated.rowCount) throw new Error('shared_lease_lost')
        })
        console.warn(`[shared-worker] job ${id} requeued (${retries + 1}/${MAX_WRITER_RETRIES}): runtime_writer_present`)
        return { state:'contended', reason:'runtime_writer_present' }
      } catch { /* could not requeue: fall through and quarantine */ }
    }
    // Never repeat an effect on error. Losing the lease prevents all writes;
    // the expiry/reconciliation operator must quarantine that persisted intent.
    try { await append('needs_intervention',{state:'unknown'}) } catch { /* retain original error and persisted intent */ }
    throw error
  }
}
