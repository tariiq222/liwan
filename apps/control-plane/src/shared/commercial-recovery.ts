import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'

const SYSTEM_RETRY_MINUTES = [5, 15, 60, 180, 360]
export const PRE_WRITE_REFUSALS = ['stale_target', 'order_not_released', 'tenant_binding_mismatch', 'input_invalid',
  'tenant_upgrade_required', 'recovery_predecessor_invalid', 'commercial_expiry_revision_stale', 'entitlement_invalid', 'features_invalid', 'downgrade_below_usage']

type TrialPredecessor = { revision_id: string; digest: string }

/** An abandoned lock is a possible host predecessor only for another attempt of the same lapse. */
export async function recoverableTrialPredecessors(client: Pick<PoolClient, 'query'>, orderId: string): Promise<TrialPredecessor[]> {
  return (await client.query(`SELECT previous.target_revision_id AS revision_id,j.payload#>>'{authority,entitlement,digest}' AS digest
    FROM orders current JOIN subscriptions s ON s.id=current.subscription_id
    JOIN orders previous ON previous.subscription_id=current.subscription_id AND previous.id<>current.id
      AND previous.expected_applied_revision_id=current.expected_applied_revision_id AND previous.effective_at=current.effective_at
      AND previous.kind='change' AND previous.cancelled AND previous.fulfillment_state='failed'
      AND previous.idempotency_key LIKE 'trial-lapse:'||s.id::text||':%'
    JOIN fulfillment_effects e ON e.order_id=previous.id
    JOIN shared_jobs j ON j.id=e.job_id AND j.control_tenant_id=s.tenant_id
    WHERE current.id=$1 AND current.kind='change' AND current.idempotency_key LIKE 'trial-lapse:'||s.id::text||':%'
      AND j.state='failed' AND j.payload->>'origin'='trial-end'
      AND j.payload#>>'{authority,order_id}'=previous.id::text
      AND j.payload#>>'{authority,target_revision_id}'=previous.target_revision_id::text
      AND (j.journal->>'may_have_written'='true' OR j.journal->>'stage'='started' OR j.journal->>'error_code' <> ALL($2::text[]))
    ORDER BY previous.target_revision_id`, [orderId, PRE_WRITE_REFUSALS])).rows
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
