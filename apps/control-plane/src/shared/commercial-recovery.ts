import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'

const SYSTEM_RETRY_MINUTES = [5, 15, 60, 180, 360]
export const PRE_WRITE_REFUSALS = ['stale_target', 'order_not_released', 'tenant_binding_mismatch', 'input_invalid',
  'tenant_upgrade_required', 'recovery_predecessor_invalid', 'commercial_expiry_revision_stale', 'entitlement_invalid', 'features_invalid', 'downgrade_below_usage']

type TrialPredecessor = { revision_id: string; digest: string }

/** Exact host predecessor identities for the active lapse lock, without transferring any paid entitlement. */
export async function recoverableTrialPredecessors(client: Pick<PoolClient, 'query'>, orderId: string): Promise<TrialPredecessor[]> {
  return (await client.query<TrialPredecessor>(`WITH lapse AS (
    SELECT current.id,current.subscription_id,current.customer_id,current.expected_applied_revision_id,current.effective_at,
      s.tenant_id,l.ended_at,l.trial_revision_id
    FROM orders current JOIN subscriptions s ON s.id=current.subscription_id
    JOIN trial_lapses l ON l.subscription_id=s.id AND l.state='ordered' AND l.order_id=current.id
    WHERE current.id=$1 AND current.kind='change' AND NOT current.cancelled
      AND current.idempotency_key LIKE 'trial-lapse:'||s.id::text||':%'
      AND s.target_revision_id=current.target_revision_id
  ), abandoned AS (
    SELECT previous.*,lapse.ended_at,lapse.trial_revision_id,j.payload,j.journal
    FROM lapse JOIN orders previous ON previous.subscription_id=lapse.subscription_id AND previous.id<>lapse.id
      AND previous.customer_id=lapse.customer_id AND previous.expected_applied_revision_id=lapse.expected_applied_revision_id
      AND previous.kind='change' AND previous.cancelled AND previous.fulfillment_state='failed'
    JOIN subscription_revisions r ON r.id=previous.target_revision_id AND r.subscription_id=lapse.subscription_id
    JOIN fulfillment_effects e ON e.order_id=previous.id
    JOIN shared_jobs j ON j.id=e.job_id AND j.control_tenant_id=lapse.tenant_id
    WHERE j.state='failed' AND j.payload->>'operation'='reconfigure' AND COALESCE(j.payload->>'restore','false')='false'
      AND NOT (j.payload ? 'restoreId') AND COALESCE(j.payload#>>'{authority,ai_push}','false')='false'
      AND j.payload#>>'{authority,order_id}'=previous.id::text
      AND j.payload#>>'{authority,target_revision_id}'=previous.target_revision_id::text
      AND j.payload#>>'{authority,previous_revision_id}'=lapse.expected_applied_revision_id::text
      AND j.payload#>>'{authority,operation_id}'=e.operation_id
      AND j.payload#>>'{authority,entitlement,digest}'=r.snapshot#>>'{entitlement,digest}'
  ), proven AS (
    SELECT b.target_revision_id AS revision_id,b.payload#>>'{authority,entitlement,digest}' AS digest
    FROM abandoned b,lapse
    WHERE b.idempotency_key LIKE 'trial-lapse:'||lapse.subscription_id::text||':%'
      AND b.effective_at=lapse.effective_at AND b.payload->>'origin'='trial-end'
      AND (b.journal->>'may_have_written'='true' OR b.journal->>'stage'='started' OR b.journal->>'error_code' <> ALL($2::text[]))
    UNION ALL
    SELECT b.target_revision_id,d.digest FROM abandoned b
    JOIN payment_attempts a ON a.id=b.paid_attempt_id AND a.order_id=b.id AND a.status='succeeded'
    JOIN commercial_outbox refund ON refund.kind='reconcile.refund' AND refund.aggregate_id=b.id::text
      AND refund.dedupe_key='fulfillment-undelivered' AND refund.payload->>'attempt_id'=a.id::text
      AND refund.payload->'automatic'='true'::jsonb
    CROSS JOIN LATERAL (VALUES (b.payload#>>'{authority,entitlement,digest}'), (b.payload#>>'{authority,post_trial_digest}')) d(digest)
    WHERE b.payment_state IN ('refund_pending','refunded') AND b.created_at<b.ended_at
      AND b.expected_applied_revision_id=b.trial_revision_id
      AND b.payload#>>'{authority,trial_ends_at}' IS NOT NULL
      AND b.journal->>'operation_id'=b.payload#>>'{authority,operation_id}'
      AND (b.journal->>'may_have_written'='true' OR b.journal->>'stage'='started')
      AND b.payload#>'{authority,branches,apply}'='[]'::jsonb
      AND b.payload#>'{authority,branches,archive}'='[]'::jsonb
      AND COALESCE(b.payload#>'{authority,branches,restore}','[]'::jsonb)='[]'::jsonb
  )
  SELECT DISTINCT revision_id,digest FROM proven WHERE digest ~ '^[a-f0-9]{64}$' ORDER BY revision_id,digest`,
  [orderId, PRE_WRITE_REFUSALS])).rows
}

/** Terminal stale effects cannot write again. System effects which might have written reuse their immutable operation. */
export async function recoverCommercialSystemJobs(pool: Pool, now = new Date()) {
  await pool.query(`UPDATE shared_jobs j SET state='failed',lease_until=NULL
    FROM subscriptions s WHERE j.control_tenant_id=s.tenant_id AND j.payload->>'operation'='reconfigure'
    AND COALESCE(j.payload->>'restore','false')='false'
    AND (j.state='queued' OR (j.state='needs_intervention' AND j.journal->>'error_code'=ANY($1::text[])))
    AND j.payload->'authority'->>'target_revision_id' IS DISTINCT FROM s.target_revision_id::text
    AND j.payload->'authority'->>'target_revision_id' IS DISTINCT FROM s.applied_revision_id::text`, [PRE_WRITE_REFUSALS])
  const due = (await pool.query(`SELECT id FROM shared_jobs WHERE payload->>'origin'='trial-end'
    AND state='needs_intervention' AND (recovery_at IS NULL OR recovery_at<=$1) ORDER BY created_at,id LIMIT 20`, [now])).rows
  for (const { id } of due) {
    await transaction(pool, async client => {
      const job = (await client.query("SELECT * FROM shared_jobs WHERE id=$1 AND state='needs_intervention' FOR UPDATE SKIP LOCKED", [id])).rows[0]
      if (!job || (job.recovery_at && job.recovery_at > now)) return
      const code = job.journal?.error_code
      const exhausted = job.recovery_attempts >= SYSTEM_RETRY_MINUTES.length
      const permanent = PRE_WRITE_REFUSALS.includes(code)
      const orderId = job.payload.authority.order_id
      const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]
      if (exhausted || permanent) {
        await client.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1", [id])
        if (order && String(order.idempotency_key).startsWith('trial-lapse:'))
          await client.query("UPDATE orders SET fulfillment_state='failed' WHERE id=$1 AND fulfillment_state<>'applied'", [orderId])
        return
      }
      if (!job.recovery_at) {
        await client.query('UPDATE shared_jobs SET recovery_at=$2 WHERE id=$1', [id, new Date(now.getTime() + SYSTEM_RETRY_MINUTES[job.recovery_attempts]! * 60_000)])
        return
      }
      await client.query("UPDATE shared_jobs SET state='queued',recovery_attempts=recovery_attempts+1,recovery_at=NULL,lease_until=NULL WHERE id=$1", [id])
      await client.query("UPDATE orders SET fulfillment_state='queued' WHERE id=$1 AND NOT cancelled AND fulfillment_state IN ('failed','needs_intervention')", [orderId])
    })
  }
}
