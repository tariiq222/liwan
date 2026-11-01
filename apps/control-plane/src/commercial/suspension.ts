import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { commercialExpiryDate } from './fulfillment.js'
import { pushCommercialExpiry } from './trial.js'

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
    const row = (await client.query(`SELECT s.id,p.grace_days,(s.trial_ends_at > now()) AS trial_running,s.trial_ends_at IS NOT NULL AS has_expiry,EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id=s.id AND i.status='issued' AND i.due_at < now()) AS overdue
      FROM subscriptions s LEFT JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
      LEFT JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
      WHERE s.id=$1 AND s.state='suspended' FOR UPDATE OF s`, [input.subscription_id])).rows[0]
    if (!row) throw new CommercialHttpError('subscription_not_suspended', 409)
    const graceDays = Math.max(1, Number(row.grace_days ?? 0))
    // A trial that is still running resumes as a trial, so ending or converting it keeps working.
    const next = row.overdue ? 'past_due' : row.trial_running ? 'trialing' : 'active'
    await client.query(`UPDATE subscriptions SET state=$2,manual_suspension=false,
      grace_ends_at=CASE WHEN $2='past_due' THEN now() + make_interval(days => $3::int) ELSE NULL END,revision=revision+1 WHERE id=$1`,
    [input.subscription_id, next, graceDays])
    // A trial's Odoo expiry (trial end plus grace) keeps the tenant read-only once it has passed, so the fresh grace period
    // has to reach Odoo too, as an ordinary revisioned expiry update. A paid subscription carries no Odoo expiry.
    if (next === 'past_due' && row.has_expiry) {
      const grace = (await client.query('SELECT grace_ends_at FROM subscriptions WHERE id=$1', [input.subscription_id])).rows[0].grace_ends_at
      await pushCommercialExpiry(client, input.subscription_id, commercialExpiryDate(grace, 0))
    }
    await audited(client, { ...input, action: 'subscription.resumed' })
  })
}

/**
 * One tenant's push, from reading the desired state to recording the acknowledgement, under a session advisory lock on
 * a dedicated connection, so two workers can never run the effect for the same tenant at once (a slower older push
 * landing after a newer one would leave Odoo and `tenant_status_pushed` disagreeing). The lock is not a transaction:
 * no transaction stays open while the effect runs. The desired state is read again after the lock is held, so a state
 * that flipped since selection is pushed, not the stale one. A tenant another worker holds is skipped (`null`).
 */
async function pushUnderLock(pool: Pool, row: { id: string; tenant_id: string }, runner: TenantStatusRunner): Promise<'pushed' | 'skipped' | null> {
  const client = await pool.connect()
  let locked = false, broken = false
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok', [`tenant-status:${row.tenant_id}`])).rows[0].ok === true
    if (!locked) return null
    const current = (await client.query(`SELECT CASE WHEN state='suspended' THEN 'suspended' ELSE 'active' END AS wanted,tenant_status_pushed AS pushed
      FROM subscriptions WHERE id=$1 AND tenant_id IS NOT NULL`, [row.id])).rows[0] as { wanted: TenantStatus; pushed: TenantStatus | null } | undefined
    if (!current || current.pushed === current.wanted) return 'skipped'
    await runner({ tenant_id: row.tenant_id, status: current.wanted })
    await client.query('UPDATE subscriptions SET tenant_status_pushed=$2,tenant_status_failures=0,tenant_status_next_at=NULL WHERE id=$1', [row.id, current.wanted])
    return 'pushed'
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`tenant-status:${row.tenant_id}`]) } catch { broken = true }
    }
    // A connection that may still hold the lock is closed, which releases it.
    client.release(broken || undefined)
  }
}

/** Backoff after a failed push: 1, 2, 4 ... 60 minutes. */
const BACKOFF_SQL = "now() + LEAST(power(2, tenant_status_failures), 60) * interval '1 minute'"

/**
 * Converges every tenant's Odoo status to its subscription: suspended stops its users, anything else lets them in.
 * `tenant_status_pushed` moves only after Odoo confirmed the write, so a failed push is retried (with backoff, so one
 * broken tenant cannot starve the others) and a state that flips while a push is in flight is corrected by the run after
 * it. A tenant with no enabled binding is not selected. Each run is bounded: `limit` rows and `budgetMs` of wall time, and
 * `busy` (a shared backup or restore running) is checked before every row.
 */
export async function syncTenantStatus(pool: Pool, input: { runner: TenantStatusRunner; limit?: number; budgetMs?: number; busy?: () => Promise<boolean>; log?: (message: string, error?: unknown) => void }) {
  const started = Date.now(), budget = input.budgetMs ?? 90_000
  const due = (await pool.query(`SELECT s.id,s.tenant_id,CASE WHEN s.state='suspended' THEN 'suspended' ELSE 'active' END AS wanted FROM subscriptions s
    JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id AND b.enabled=true
    WHERE s.tenant_status_pushed IS DISTINCT FROM CASE WHEN s.state='suspended' THEN 'suspended' ELSE 'active' END
      AND (s.tenant_status_next_at IS NULL OR s.tenant_status_next_at <= now())
    ORDER BY s.tenant_status_next_at NULLS FIRST, s.id LIMIT $1`, [input.limit ?? 5])).rows as { id: string; tenant_id: string; wanted: TenantStatus }[]
  const pushed: string[] = [], failed: string[] = []
  for (const row of due) {
    if (Date.now() - started >= budget || await input.busy?.()) break
    const outcome = await pushUnderLock(pool, row, input.runner).catch(async error => {
      await pool.query(`UPDATE subscriptions SET tenant_status_failures=tenant_status_failures+1,tenant_status_next_at=${BACKOFF_SQL} WHERE id=$1`, [row.id])
      input.log?.(`tenant status ${row.wanted} not pushed for subscription ${row.id}`, error)
      return 'failed' as const
    })
    if (outcome === 'pushed') pushed.push(row.id)
    else if (outcome === 'failed') failed.push(row.id)
  }
  return { pushed, failed }
}
