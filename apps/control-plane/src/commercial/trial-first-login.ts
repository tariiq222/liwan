import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { trialEndsAt } from './renewals.js'
import { queueTrialPolicyRevision } from './trial-policy-order.js'

// Odoo already enforces the fallback after a cutoff, even when the worker is offline.
// An unopened workspace delivers the fallback immediately. This date is never a customer deadline.
export const unopenedTrialCutoff = '1970-01-01T00:00:00.000Z'

// The lock is its own statement: after a lock wait, a joined read in the same statement keeps its old
// snapshot of `orders` and would miss the bootstrap order the lock holder just committed.
async function firstLoginTrial(client: Pick<PoolClient, 'query'>, customerId: string, lock = false) {
  if (lock) await client.query('SELECT 1 FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [customerId])
  return (await client.query(`SELECT s.id,s.customer_id,s.tenant_id,s.state,s.revision,s.applied_revision_id,s.target_revision_id,
    s.trial_ends_at,s.manual_suspension,t.first_admin_user_id,o.fulfillment_state
    FROM subscriptions s JOIN public_signup_trials t ON t.customer_id=s.customer_id AND t.requires_first_login
    LEFT JOIN orders o ON o.subscription_id=s.id AND o.target_revision_id=s.target_revision_id AND o.idempotency_key LIKE 'trial-bootstrap:%'
    WHERE s.customer_id=$1`, [customerId])).rows[0]
}

function activationState(row: Awaited<ReturnType<typeof firstLoginTrial>>, actorId: string) {
  if (!row || String(row.first_admin_user_id) !== actorId || row.state !== 'trialing' || row.manual_suspension)
    return { state: 'not_required' } as const
  if (!row.trial_ends_at) return { state: 'waiting' } as const
  const trial_ends_at = new Date(row.trial_ends_at).toISOString()
  if (row.fulfillment_state === 'failed' || row.fulfillment_state === 'needs_intervention')
    return { state: 'failed', trial_ends_at } as const
  return { state: row.fulfillment_state ? 'applying' as const : 'ready' as const, trial_ends_at }
}

export async function signupTrialActivation(pool: Pool, customerId: string, actorId: string) {
  return activationState(await firstLoginTrial(pool, customerId), actorId)
}

export async function activateSignupTrial(pool: Pool, input: { customerId: string; actorId: string; now: Date }) {
  return transaction(pool, async client => {
    const row = await firstLoginTrial(client, input.customerId, true)
    const status = activationState(row, input.actorId)
    if (status.state !== 'waiting') return status
    if (!row.applied_revision_id || row.target_revision_id) return status
    const ready = await client.query(`SELECT 1 FROM tenants t JOIN shared_registry_bindings b
      ON b.control_tenant_id=t.id AND b.enabled
      WHERE t.id=$1 AND t.post_trial_supported IS TRUE AND t.excess_supported IS TRUE`, [row.tenant_id])
    if (!ready.rowCount) throw new CommercialHttpError('tenant_upgrade_required', 409)
    const trial_ends_at = trialEndsAt(14, input.now)
    const queued = await queueTrialPolicyRevision(client, row, {
      kind: 'trial-bootstrap', sourceId: row.applied_revision_id, now: input.now, startsAt: input.now, endsAt: new Date(trial_ends_at),
    })
    if (!queued) throw new CommercialHttpError('trial_order_unavailable', 409)
    await client.query(`UPDATE subscriptions SET trial_ends_at=$2,renewal_at=$3,target_revision_id=$4,revision=revision+1
      WHERE id=$1`, [row.id, trial_ends_at, queued.periodEnd, queued.revisionId])
    await client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
      VALUES($1,$2,'trial.started',$3,'Invited administrator signed in',$4)`,
    [randomUUID(), input.actorId, input.customerId, JSON.stringify({ trial_ends_at, target_revision_id: queued.revisionId })])
    return { state: 'applying', trial_ends_at } as const
  })
}
