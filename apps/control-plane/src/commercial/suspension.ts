import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'

export type TenantStatus = 'active' | 'suspended'
/** Writes the tenant's Odoo profile status (the shared worker's Odoo adapter); resolves once Odoo confirmed it. */
export type TenantStatusRunner = (input: { tenant_id: string; status: TenantStatus }) => Promise<unknown>

/** States a vendor may suspend: the tenant is in use and not already stopped. */
const SUSPENDABLE = ['active', 'past_due', 'trialing']

async function audited(client: { query: Pool['query'] }, input: { subscription_id: string; actor: string; action: string; reason: string }) {
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), input.actor, input.action, input.subscription_id, input.reason, JSON.stringify({})])
}

/** Vendor action: stop the tenant now. A payment does not lift it; only `resumeSubscription` does. */
export async function suspendSubscription(pool: Pool, input: { subscription_id: string; reason: string; actor: string }) {
  await transaction(pool, async client => {
    const updated = await client.query(`UPDATE subscriptions SET state='suspended',manual_suspension=true,revision=revision+1
      WHERE id=$1 AND state = ANY($2::text[]) RETURNING id`, [input.subscription_id, SUSPENDABLE])
    if (!updated.rowCount) throw new CommercialHttpError('subscription_not_suspendable', 409)
    await audited(client, { ...input, action: 'subscription.suspended' })
  })
}

/**
 * Vendor action: let the tenant work again. A subscription that still owes an overdue invoice goes back to past due
 * with a fresh grace period (the plan's, at least one day), so the next dunning run does not stop it again at once.
 */
export async function resumeSubscription(pool: Pool, input: { subscription_id: string; reason: string; actor: string }) {
  await transaction(pool, async client => {
    const row = (await client.query(`SELECT s.id,p.grace_days,EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id=s.id AND i.status='issued' AND i.due_at < now()) AS overdue
      FROM subscriptions s LEFT JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
      LEFT JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
      WHERE s.id=$1 AND s.state='suspended' FOR UPDATE OF s`, [input.subscription_id])).rows[0]
    if (!row) throw new CommercialHttpError('subscription_not_suspended', 409)
    const graceDays = Math.max(1, Number(row.grace_days ?? 0))
    await client.query(`UPDATE subscriptions SET state=$2,manual_suspension=false,
      grace_ends_at=CASE WHEN $2='past_due' THEN now() + make_interval(days => $3::int) ELSE NULL END,revision=revision+1 WHERE id=$1`,
    [input.subscription_id, row.overdue ? 'past_due' : 'active', graceDays])
    await audited(client, { ...input, action: 'subscription.resumed' })
  })
}

/**
 * Converges every tenant's Odoo status to its subscription: suspended stops its users, anything else lets them in.
 * `tenant_status_pushed` moves only after Odoo confirmed the write, so a failed push is retried on the next run and a
 * state that flips while a push is in flight is corrected by the run after it. Returns what was pushed and what failed.
 */
export async function syncTenantStatus(pool: Pool, input: { runner: TenantStatusRunner; limit?: number; log?: (message: string, error?: unknown) => void }) {
  const due = (await pool.query(`SELECT id,tenant_id,CASE WHEN state='suspended' THEN 'suspended' ELSE 'active' END AS wanted FROM subscriptions
    WHERE tenant_id IS NOT NULL AND tenant_status_pushed <> CASE WHEN state='suspended' THEN 'suspended' ELSE 'active' END
    ORDER BY id LIMIT $1`, [input.limit ?? 20])).rows as { id: string; tenant_id: string; wanted: TenantStatus }[]
  const pushed: string[] = [], failed: string[] = []
  for (const row of due) {
    try {
      await input.runner({ tenant_id: row.tenant_id, status: row.wanted })
      await pool.query('UPDATE subscriptions SET tenant_status_pushed=$2,revision=revision+1 WHERE id=$1', [row.id, row.wanted])
      pushed.push(row.id)
    } catch (error) {
      failed.push(row.id)
      input.log?.(`tenant status ${row.wanted} not pushed for subscription ${row.id}`, error)
    }
  }
  return { pushed, failed }
}
