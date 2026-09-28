import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import type { SharedJob } from '@nasq/commercial-contracts/shared'
import { transaction } from '../db.js'
import { resolveRegistryBinding } from './registry-store.js'
import { requireJobAuthority } from './job-store.js'
import { bindJob, businessKey, payloadDigest, reconcileSharedJob, verifiedReceipt } from './provisioning.js'

/** The physical adapter must atomically enforce fence validity at each mutation.
 * A caller-provided callback or a preflight lease check alone is NOT sufficient.
 * No production adapter is configured by default. */
export interface SharedFencedAdapter {
  observe(job: SharedJob): Promise<unknown>
  applyFenced(input: { job: SharedJob; attemptId: string; fence: number; assertOwned: () => Promise<void> }): Promise<void>
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
    // Persisted payload is not a durable restore approval or backup authority.
    if (job.operation === 'restore') throw new Error('shared_restore_authority_unavailable')
    if (row.business_key !== businessKey(job) || row.payload_digest !== payloadDigest(job)) throw new Error('shared_job_identity_corrupt')
    if (row.journal && row.journal.attemptId !== row.attempt_id) throw new Error('shared_job_identity_corrupt')
    const target = await resolveRegistryBinding(client,row.control_tenant_id)
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
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),actor.issuer+':'+actor.actorUid,'shared_job.recovery_observed',id,reason])
    if (!['record_verified','replay_verified'].includes(decision.action)) return { state:'needs_intervention' }
    const journal = { ...row.journal,sequence:nextSequence(row.journal.sequence),stage:'verified' }
    const receipt = verifiedReceipt(job,target,journal,fresh)
    await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,journal.attemptId,fence,journal.sequence,'verified',{observation:fresh,receipt,recoveredBy:actor}])
    const updated = await client.query("UPDATE shared_jobs SET journal=$1,receipt=$2,state='verified',lease_until=NULL WHERE id=$3 AND fence=$4 AND state='needs_intervention' RETURNING id", [journal,receipt,id,fence])
    if (!updated.rowCount) throw new Error('shared_lease_lost')
    return { state:'verified',receipt }
  })
}
export async function runSharedJob(pool: Pool, id: string, adapter?: SharedFencedAdapter) {
  if (!adapter) throw new Error('shared_adapter_unavailable')
  z.uuid().parse(id)
  const claim = await transaction(pool, async client => {
    const result = await client.query("SELECT * FROM shared_jobs WHERE id=$1 AND state='queued' FOR UPDATE", [id])
    if (!result.rowCount) throw new Error('shared_job_not_claimable')
    const row = result.rows[0]
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [row.control_tenant_id])
    const unresolved = await client.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND id<>$2 AND state IN ('running','needs_intervention') LIMIT 1", [row.control_tenant_id,id])
    if (unresolved.rowCount) throw new Error('shared_reconciliation_required')
    await requireJobAuthority(client, row.control_tenant_id, { issuer: row.issuer, actorUid: Number(row.actor_uid) })
    const job = bindJob(row.payload)
    // Persisted payload is not a durable restore approval or backup authority.
    if (job.operation === 'restore') throw new Error('shared_restore_authority_unavailable')
    if (row.business_key !== businessKey(job) || row.payload_digest !== payloadDigest(job)) throw new Error('shared_job_identity_corrupt')
    const target = await resolveRegistryBinding(client, row.control_tenant_id)
    reconcileSharedJob(job,target,row.journal ?? null,{ state:'unknown' })
    const previousFence = Number(row.fence)
    if (!Number.isSafeInteger(previousFence) || previousFence < 0 || previousFence >= Number.MAX_SAFE_INTEGER) throw new Error('shared_fence_invalid')
    const attemptId = randomUUID(), fence = previousFence + 1
    await client.query("UPDATE shared_jobs SET state='running',attempt_id=$1,fence=$2,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$3", [attemptId,fence,id])
    return { row,job,attemptId,fence }
  })
  const owned = async <T>(action: (client: PoolClient, row: Record<string, any>) => Promise<T>) => transaction(pool, async client => {
    const current = await client.query("SELECT * FROM shared_jobs WHERE id=$1 AND attempt_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE", [id,claim.attemptId,claim.fence])
    if (!current.rowCount) throw new Error('shared_lease_lost')
    await requireJobAuthority(client, claim.row.control_tenant_id, { issuer: claim.row.issuer, actorUid: Number(claim.row.actor_uid) })
    const target = await resolveRegistryBinding(client,claim.row.control_tenant_id)
    reconcileSharedJob(claim.job,target,current.rows[0].journal,{state:'unknown'})
    return action(client,current.rows[0])
  })
  const assertOwned = () => owned(async () => {})
  const append = async (stage: 'prepared'|'started'|'verified'|'needs_intervention', observation: unknown) => owned(async (client,row) => {
    const journal = { schemaVersion:1,job:claim.job,attemptId:claim.attemptId,sequence:nextSequence(row.journal?.sequence ?? 0),stage }
    await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,claim.attemptId,claim.fence,journal.sequence,stage,{observation}])
    const updated = await client.query("UPDATE shared_jobs SET journal=$1 WHERE id=$2 AND attempt_id=$3 AND fence=$4 AND state='running' AND lease_until>clock_timestamp() RETURNING id", [journal,id,claim.attemptId,claim.fence])
    if (!updated.rowCount) throw new Error('shared_lease_lost')
    if (stage === 'needs_intervention') await client.query("UPDATE shared_jobs SET state='needs_intervention',lease_until=NULL WHERE id=$1", [id])
    return journal
  })
  let journal = claim.row.journal ?? null
  try {
    await assertOwned()
    let observation = await adapter.observe(claim.job)
    const target = await transaction(pool, client => resolveRegistryBinding(client,claim.row.control_tenant_id))
    let decision = reconcileSharedJob(claim.job,target,journal,observation)
    if (decision.action === 'persist_intent') {
      journal = await append('prepared',observation)
      decision = reconcileSharedJob(claim.job,target,journal,observation)
    }
    if (decision.action === 'execute') {
      journal = await append('started',observation)
      await assertOwned()
      await adapter.applyFenced({job:claim.job,attemptId:claim.attemptId,fence:claim.fence,assertOwned})
      await assertOwned()
      observation = await adapter.observe(claim.job)
      const freshTarget = await transaction(pool, client => resolveRegistryBinding(client,claim.row.control_tenant_id))
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
    return await owned(async (client,row) => {
      const verified = { schemaVersion:1,job:claim.job,attemptId:claim.attemptId,sequence:nextSequence(row.journal?.sequence ?? 0),stage:'verified' }
      const currentTarget = await resolveRegistryBinding(client,claim.row.control_tenant_id)
      const receipt = verifiedReceipt(claim.job,currentTarget,verified,observation)
      await client.query('INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5,$6)', [id,claim.attemptId,claim.fence,verified.sequence,'verified',{observation,receipt}])
      const updated = await client.query("UPDATE shared_jobs SET journal=$1,receipt=$2,state='verified',lease_until=NULL WHERE id=$3 AND attempt_id=$4 AND fence=$5 AND state='running' AND lease_until>clock_timestamp() RETURNING id", [verified,receipt,id,claim.attemptId,claim.fence])
      if (!updated.rowCount) throw new Error('shared_lease_lost')
      return { state:'verified',receipt }
    })
  } catch (error) {
    // Never repeat an effect on error. Losing the lease prevents all writes;
    // the expiry/reconciliation operator must quarantine that persisted intent.
    try { await append('needs_intervention',{state:'unknown'}) } catch { /* retain original error and persisted intent */ }
    throw error
  }
}
