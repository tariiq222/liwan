import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { nextOrderState } from '@liwan/commercial-contracts'
import { sharedReconfigureJobSchema, type SharedReconfigureJob } from '@liwan/commercial-contracts/shared'
import { transaction } from '../db.js'
import { PRE_WRITE_REFUSALS } from '../shared/commercial-recovery.js'
import { enqueueReconfigureJob } from '../shared/job-store.js'
import { enqueueOutbox } from './outbox.js'
import { markTopupRefunded } from './ai-ledger.js'
import { recordFulfillmentFailure } from './settlements.js'

const RETRY_MINUTES = [5, 15, 60]
const PERMANENT = ['stale_target', 'provision_needs_intervention', 'order_not_released', 'renewal_missing',
  'enrollment_base_catalog_missing', 'enrollment_link_conflict', 'idempotency_conflict', 'shared_replay_forbidden']

const permanentFailure = (code: string | null) => Boolean(code && (PERMANENT.includes(code) || code.startsWith('retries_exhausted:')))

/** A known non-retryable refusal releases the target on the next pass. Others retry at 5, 15 and 60 minutes. */
export async function scheduleFulfillmentRecovery(client: PoolClient, order: Record<string, any>, code: string) {
  const minutes = permanentFailure(code) ? 0 : RETRY_MINUTES[order.fulfillment_retries] ?? 0
  await client.query(`UPDATE orders SET fulfillment_retry_at=CASE WHEN $2::int>0 THEN now()+make_interval(mins=>$2::int) ELSE NULL END,fulfillment_failure_code=$3 WHERE id=$1`,
    [order.id, minutes, code])
}

const recoverable = `(o.payment_state='paid' OR (o.payment_state='not_required' AND (o.idempotency_key LIKE 'trial-reopen:%' OR o.idempotency_key LIKE 'trial-bootstrap:%' OR EXISTS (
  SELECT 1 FROM trial_lapses l WHERE l.subscription_id=o.subscription_id AND l.state='pending'
))))`

type RecoveryJob = {
  id: string; state: string; control_tenant_id: string; payload: unknown
  journal: { stage?: string; operation_id?: string; error_code?: string; may_have_written?: boolean } | null
}
type EffectLink = { job_id: string | null; operation_id: string }
type RecoveryOrder = Parameters<typeof nextOrderState>[0] & {
  id: string; target_revision_id: string; expected_applied_revision_id: string | null
}
type BoundDelivery = Pick<SharedReconfigureJob, 'binding' | 'host'>

function matchingJob(order: Record<string, any>, subscription: Record<string, any>, effect: EffectLink | undefined, job: RecoveryJob | undefined) {
  if (!job || job.id !== effect?.job_id || job.control_tenant_id !== subscription.tenant_id) return null
  const parsed = sharedReconfigureJobSchema.safeParse(job.payload)
  if (!parsed.success || parsed.data.restore || parsed.data.restoreId || parsed.data.authority.ai_push) return null
  const delivery = parsed.data
  const a = delivery.authority
  return delivery.controlTenantId === subscription.tenant_id && a.order_id === order.id
    && a.operation_id === effect.operation_id && a.target_revision_id === order.target_revision_id
    && a.previous_revision_id === order.expected_applied_revision_id ? delivery : null
}

function provenPreWrite(job: RecoveryJob, delivery: SharedReconfigureJob) {
  const journal = job.journal
  return journal?.may_have_written === false && ['failed', 'needs_intervention'].includes(journal.stage ?? '')
    && journal.operation_id === delivery.authority.operation_id && PRE_WRITE_REFUSALS.includes(journal.error_code ?? '')
}

async function currentBinding(client: PoolClient, tenantId: string): Promise<BoundDelivery | null> {
  const b = (await client.query(`SELECT tenant_id,database_name,filestore,registry_revision,host FROM shared_registry_bindings
    WHERE control_tenant_id=$1 AND enabled FOR SHARE`, [tenantId])).rows[0]
  return b ? { host: b.host, binding: { tenantId: b.tenant_id, database: b.database_name, filestore: b.filestore,
    registryRevision: Number(b.registry_revision) } } : null
}

function sameBinding(a: BoundDelivery, b: BoundDelivery) {
  return a.host === b.host && a.binding.tenantId === b.binding.tenantId && a.binding.database === b.binding.database
    && a.binding.filestore === b.binding.filestore && a.binding.registryRevision === b.binding.registryRevision
}

function deferRecovery(client: PoolClient, orderId: string, now: Date) {
  return client.query('UPDATE orders SET fulfillment_retry_at=$2 WHERE id=$1', [orderId, new Date(now.getTime() + 15 * 60_000)])
}

async function queueSameDelivery(client: PoolClient, order: RecoveryOrder, job: RecoveryJob,
  delivery: SharedReconfigureJob, now: Date, currentTarget: boolean) {
  const binding = currentTarget && await currentBinding(client, job.control_tenant_id)
  if (!binding || !sameBinding(binding, delivery)) {
    await deferRecovery(client, order.id, now)
    return
  }
  // The host will verify the exact old effect before running it again. Its original branch ids and operation id stay fenced.
  const next = nextOrderState(order, { type: 'fulfillment_retry' })
  await client.query("UPDATE shared_jobs SET state='queued',lease_until=NULL WHERE id=$1", [job.id])
  await client.query('UPDATE orders SET fulfillment_state=$2,fulfillment_retry_at=NULL WHERE id=$1', [order.id, next.fulfillment_state])
}

async function requeueTrialPolicy(client: PoolClient, order: RecoveryOrder, subscription: Record<string, any>,
  effect: EffectLink | undefined, job: RecoveryJob | undefined, delivery: SharedReconfigureJob | null, currentTarget: boolean, now: Date) {
  if (!currentTarget || subscription.applied_revision_id !== order.expected_applied_revision_id) {
    await deferRecovery(client, order.id, now)
    return
  }
  if (job && delivery && !provenPreWrite(job, delivery)) {
    await queueSameDelivery(client, order, job, delivery, now, true)
    return
  }
  const binding = await currentBinding(client, subscription.tenant_id)
  if (!binding || (job && !delivery) || (!job && effect)) {
    await deferRecovery(client, order.id, now)
    return
  }
  const operation = randomUUID()
  if (job && delivery) {
    // The old immutable job refused before any possible write. Keep the audited order and cutoff, and
    // use a new operation identity so a previously failed business-key replay cannot swallow the retry.
    if (sameBinding(binding, delivery) && job.journal?.error_code !== 'tenant_upgrade_required') {
      await deferRecovery(client, order.id, now)
      return
    }
    await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1", [job.id])
    const replacement = await enqueueReconfigureJob(client, {
      ...delivery, ...binding, requestId: operation, authority: { ...delivery.authority, operation_id: operation },
    }, { unique: true })
    await client.query('UPDATE fulfillment_effects SET job_id=$2,operation_id=$3 WHERE order_id=$1',
      [order.id, replacement.id, operation])
  } else {
    // No fulfillment effect was ever linked. The normal outbox worker builds the first host authority.
    await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: order.id, dedupe_key: `policy-rebind:${operation}`,
      payload: { order_id: order.id, subscription_id: subscription.id, target_revision_id: order.target_revision_id } })
  }
  const next = nextOrderState(order, { type: 'fulfillment_retry' })
  await client.query('UPDATE orders SET fulfillment_state=$2,fulfillment_retries=0,fulfillment_retry_at=NULL WHERE id=$1',
    [order.id, next.fulfillment_state])
}

export async function recoverPaidFulfillment(pool: Pool, now = new Date()) {
  const due = (await pool.query(`SELECT id,subscription_id FROM orders o WHERE ${recoverable} AND NOT cancelled
    AND fulfillment_state IN ('failed','needs_intervention') AND COALESCE(fulfillment_retry_at,created_at)<=$1 ORDER BY created_at,id LIMIT 20`, [now])).rows
  for (const candidate of due) {
    try {
      await transaction(pool, async client => {
        const subscription = (await client.query('SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE SKIP LOCKED', [candidate.subscription_id])).rows[0]
        if (!subscription) return
        const order = (await client.query(`SELECT o.* FROM orders o WHERE id=$1 AND ${recoverable} AND NOT cancelled
          AND fulfillment_state IN ('failed','needs_intervention') AND COALESCE(fulfillment_retry_at,created_at)<=$2 FOR UPDATE SKIP LOCKED`, [candidate.id, now])).rows[0]
        if (!order) return
        const open = (await client.query(`SELECT id,state FROM shared_jobs WHERE payload->>'operation'='reconfigure'
          AND payload->'authority'->>'order_id'=$1 AND state IN ('running','queued','needs_intervention')
          ORDER BY created_at DESC LIMIT 1`, [order.id])).rows[0]
        const effect = (await client.query<EffectLink>('SELECT job_id,operation_id FROM fulfillment_effects WHERE order_id=$1', [order.id])).rows[0]
        const jobId = open?.id ?? effect?.job_id
        const job = jobId ? (await client.query<RecoveryJob>('SELECT id,state,control_tenant_id,payload,journal FROM shared_jobs WHERE id=$1 FOR UPDATE SKIP LOCKED', [jobId])).rows[0] : undefined
        if (jobId && (!job || ['running','queued','verified'].includes(job.state))) return
        const delivery = matchingJob(order, subscription, effect, job)
        const currentTarget = subscription.target_revision_id === order.target_revision_id
          || order.kind === 'renewal' && subscription.applied_revision_id === order.target_revision_id
        if (currentTarget && !permanentFailure(order.fulfillment_failure_code) && order.fulfillment_retries < RETRY_MINUTES.length) {
          const next = nextOrderState(order, { type: 'fulfillment_retry' })
          await client.query(`UPDATE orders SET fulfillment_state=$2,fulfillment_retries=fulfillment_retries+1,fulfillment_retry_at=NULL WHERE id=$1`, [order.id, next.fulfillment_state])
          if (job?.state === 'needs_intervention')
            await client.query("UPDATE shared_jobs SET state='queued',lease_until=NULL WHERE id=$1", [job.id])
          else await enqueueOutbox(client, { kind: 'fulfillment.enqueue', aggregate_id: order.id, dedupe_key: `retry:${order.fulfillment_retries + 1}`,
            payload: { order_id: order.id, subscription_id: subscription.id, target_revision_id: order.target_revision_id } })
          return
        }
        if (/^trial-(reopen|bootstrap):/.test(order.idempotency_key)) {
          await requeueTrialPolicy(client, order, subscription, effect, job, delivery, currentTarget, now)
          return
        }
        if (order.payment_state === 'paid' && job) {
          const branches = delivery?.authority.branches
          const topologyUncertain = !branches || branches.apply.length || branches.archive.length || branches.restore?.length
          if (topologyUncertain && (!delivery || !provenPreWrite(job, delivery))) {
            if (delivery) await queueSameDelivery(client, order, job, delivery, now, currentTarget)
            else await deferRecovery(client, order.id, now)
            return
          }
        }
        if (job?.state === 'needs_intervention') await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1", [job.id])
        if (order.payment_state === 'paid') {
          await markTopupRefunded(client, order.id, 'system', 'fulfillment not delivered')
          await recordFulfillmentFailure(client, { order_id: order.id, reason: order.fulfillment_failure_code ?? 'fulfillment_not_delivered', actor: 'commercial-fulfillment' })
          await client.query("UPDATE orders SET payment_state='refund_pending' WHERE id=$1", [order.id])
          await enqueueOutbox(client, { kind: 'reconcile.refund', aggregate_id: order.id, dedupe_key: 'fulfillment-undelivered',
            payload: { attempt_id: order.paid_attempt_id, automatic: true } })
        }
        await client.query("UPDATE orders SET fulfillment_state='failed',cancelled=true,fulfillment_retry_at=NULL WHERE id=$1", [order.id])
        await client.query('UPDATE subscriptions SET target_revision_id=NULL,revision=revision+1 WHERE id=$1 AND target_revision_id=$2', [subscription.id, order.target_revision_id])
        // Reservations for failed add/restore orders must not consume capacity after release.
        await client.query(`UPDATE commercial_branches SET state=CASE WHEN odoo_company_id IS NULL THEN 'failed' ELSE 'archived' END,
          archived_at=CASE WHEN odoo_company_id IS NULL THEN NULL ELSE now() END WHERE order_id=$1 AND state='pending'`, [order.id])
      })
    } catch (error) {
      console.error(`[paid-fulfillment-recovery] order ${candidate.id}`, error)
      await pool.query(`UPDATE orders SET fulfillment_retry_at=$2 WHERE id=$1 AND NOT cancelled
        AND fulfillment_state IN ('failed','needs_intervention')`, [candidate.id, new Date(now.getTime()+5*60_000)])
        .catch(recordError => console.error(`[paid-fulfillment-recovery] could not defer ${candidate.id}`, recordError))
    }
  }
}
