import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { queueTrialPolicyRevision } from './trial-policy-order.js'
import { voidUnpaidRenewals } from './free-base-lock.js'

type Query = Pick<PoolClient, 'query'>
type Subscription = {
  id: string; customer_id: string; tenant_id: string; state: string; revision: number
  applied_revision_id: string | null; target_revision_id: string | null; trial_outcome: string | null
  manual_suspension: boolean
}

const unavailable = () => new CommercialHttpError('trial_not_reopenable', 409)

/** A cancellation drop is never reopened as a trial: its `pre_lock_revision_id` is a paying customer's paid configuration, which a trial reopen would restore free of charge. (A refund lock of a trialling customer stays reopenable by the vendor, an existing tested decision.) The old lock must still be the applied revision. A paid renewal or a later change owns its own configuration. */
export async function settledTrialReopenSource(client: Query, sub: Subscription) {
  if (!['free_base','kept_subset'].includes(sub.trial_outcome ?? '') || sub.target_revision_id || sub.manual_suspension
    || !['active','past_due','suspended'].includes(sub.state)) return null
  return (await client.query(`SELECT l.pre_lock_revision_id,l.period_start::text AS period_start
    FROM free_base_locks l JOIN orders o ON o.id=l.order_id
    WHERE l.subscription_id=$1 AND l.state='done' AND l.cause<>'cancelled' AND o.target_revision_id=$2 AND NOT EXISTS (
      SELECT 1 FROM renewals r JOIN orders charged ON charged.id=r.order_id
      WHERE r.subscription_id=$1 AND r.period_start>=l.period_start AND r.status<>'superseded' AND charged.due_now_minor>0
        AND charged.payment_state IN ('paid','refund_pending','refunded'))`, [sub.id, sub.applied_revision_id])).rows[0] ?? null
}

/** Reopening needs a new immutable delivery, since Odoo may already have materialized the restricted digest. */
export async function reopenTrialOn(client: PoolClient, sub: Subscription, input: { endsAt: Date; now: Date; actor: string; reason: string }) {
  if (sub.manual_suspension || sub.target_revision_id || !sub.applied_revision_id || sub.trial_outcome === 'converted') throw unavailable()
  const support = (await client.query('SELECT post_trial_supported,excess_supported FROM tenants WHERE id=$1', [sub.tenant_id])).rows[0]
  if (support?.post_trial_supported !== true || support.excess_supported !== true) throw new CommercialHttpError('tenant_upgrade_required', 409)
  const binding = await client.query('SELECT 1 FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled FOR SHARE', [sub.tenant_id])
  if (!binding.rowCount) throw new CommercialHttpError('tenant_binding_unavailable', 409)
  const lapse = sub.state === 'trialing' ? null : await settledTrialReopenSource(client, sub)
  if (sub.state !== 'trialing' && !lapse) throw unavailable()
  const sourceId = lapse?.pre_lock_revision_id ?? sub.applied_revision_id
  const voided = lapse ? await voidUnpaidRenewals(client, sub.id, lapse.period_start) : []
  const queued = await queueTrialPolicyRevision(client, sub, { ...input, sourceId, kind: 'trial-reopen' })
  if (!queued) throw unavailable()
  const { revisionId, periodEnd } = queued
  await client.query(`UPDATE subscriptions SET state='trialing',trial_ends_at=$2,trial_ended_at=NULL,trial_outcome=NULL,trial_paid_through=NULL,
    grace_ends_at=NULL,billing_blocked_at=NULL,renewal_at=$3,target_revision_id=$4,revision=revision+1 WHERE id=$1`, [sub.id,input.endsAt,periodEnd,revisionId])
  if (lapse) await client.query("UPDATE free_base_locks SET state='superseded',reason=NULL WHERE subscription_id=$1", [sub.id])
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), input.actor, 'trial.reopened', sub.id, input.reason, JSON.stringify({
      source_revision_id: sourceId, target_revision_id: revisionId, trial_ends_at: input.endsAt, voided_order_ids: voided,
    })])
  return { customer_id: sub.customer_id, trial_ends_at: input.endsAt }
}
