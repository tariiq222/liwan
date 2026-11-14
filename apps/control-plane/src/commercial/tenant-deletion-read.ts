import type { Pool } from 'pg'
import { TENANT_DELETION_HOLD_HOURS, tenantDeletionRequestSchema, tenantDeletionRunSchema, tenantDeletionSchema, type TenantDeletion, type TenantDeletionRequest, type TenantDeletionRun } from '@liwan/commercial-contracts'
import { CommercialHttpError } from './lifecycle.js'
import { deletionPrechecks, type DeletionPlan } from './tenant-deletion-plan.js'

const iso = (value: Date | string | null): string | null => value === null ? null : value instanceof Date ? value.toISOString() : value
/** The states of a request that has not ended: asked, confirmed, due or deleting. A customer has at most one. */
export const OPEN_DELETION_STATES = ['requested', 'confirmed', 'due', 'deleting']

/** SQL: the customer named by `customerColumn` has a deletion whose clock is running (confirmed, due or deleting). A paid period is never opened for it. */
export const deletionClockRunningSql = (customerColumn: string) =>
  `EXISTS (SELECT 1 FROM tenant_deletion_requests d WHERE d.customer_id=${customerColumn} AND d.state IN ('confirmed','due','deleting'))`

/** SQL: the workspace of the customer named by `customerColumn` is being or has been deleted (access stopped). Nothing may act on it any more. */
export const tenantRetiringSql = (customerColumn: string) =>
  `EXISTS (SELECT 1 FROM tenant_deletion_requests d WHERE d.customer_id=${customerColumn} AND d.state IN ('deleting','deleted'))`

/** Refuses (409 `tenant_retiring`) anything that would create or change the customer's commercial state once its workspace is being or has been deleted. */
export async function assertCustomerNotRetiring(pool: Pick<Pool, 'query'>, customerId: string): Promise<void> {
  if ((await pool.query(`SELECT ${tenantRetiringSql('$1')} AS retiring`, [customerId])).rows[0].retiring === true) throw new CommercialHttpError('tenant_retiring', 409)
}

/** What the tenant sees of its open request, or null. */
export async function tenantDeletionOf(pool: Pick<Pool, 'query'>, customerId: string): Promise<TenantDeletion | null> {
  const row = (await pool.query(`SELECT * FROM tenant_deletion_requests WHERE customer_id=$1 AND state=ANY($2::text[])`, [customerId, OPEN_DELETION_STATES])).rows[0]
  return row ? tenantDeletionSchema.parse({ state: row.state, requested_at: iso(row.requested_at), code_expires_at: iso(row.code_expires_at),
    confirmed_at: iso(row.confirmed_at), due_at: iso(row.due_at), hold_until: iso(row.hold_until), can_withdraw: row.state !== 'deleting' }) : null
}

const viewOf = (row: Record<string, any>): TenantDeletionRequest => tenantDeletionRequestSchema.parse({
  id: row.id, customer_id: row.customer_id, state: row.state, requested_at: iso(row.requested_at), requested_by: row.requested_by,
  confirmed_at: iso(row.confirmed_at), due_at: iso(row.due_at), due_marked_at: iso(row.due_marked_at),
  withdrawn_at: iso(row.withdrawn_at), withdrawn_by: row.withdrawn_by, withdraw_reason: row.withdraw_reason,
  renewal_outcome: row.renewal_outcome, renewal_refusal: row.renewal_refusal,
  hold_until: iso(row.hold_until), deleting_at: iso(row.deleting_at), committed_at: iso(row.committed_at), deleted_at: iso(row.deleted_at),
  stuck_at: iso(row.stuck_at), stuck_code: row.stuck_code,
})

/** The vendor's list: every request, newest first, optionally one state. */
export async function listTenantDeletionRequests(pool: Pool, state: string | null) {
  const rows = (await pool.query(`SELECT * FROM tenant_deletion_requests WHERE $1::text IS NULL OR state=$1 ORDER BY requested_at DESC,id LIMIT 200`, [state])).rows
  return { items: rows.map(viewOf), total: rows.length }
}

/** The vendor's view of one customer: its latest request, withdrawn ones included. */
export async function latestTenantDeletionRequest(pool: Pool, customerId: string): Promise<TenantDeletionRequest | null> {
  const row = (await pool.query('SELECT * FROM tenant_deletion_requests WHERE customer_id=$1 ORDER BY requested_at DESC,id LIMIT 1', [customerId])).rows[0]
  return row ? viewOf(row) : null
}


/** The vendor's read-only view of the run for one customer: the frozen plan, the pre-checks as they stand now, the step ledger. Null when the customer never asked. */
export async function tenantDeletionRunOf(pool: Pool, customerId: string, mode: { enabled: boolean; reason: 'kill_switch_off' | 'mail_host_unset' | 'local_mail_capture' | null }): Promise<TenantDeletionRun | null> {
  const row = (await pool.query('SELECT * FROM tenant_deletion_requests WHERE customer_id=$1 ORDER BY requested_at DESC,id LIMIT 1', [customerId])).rows[0]
  if (!row) return null
  const tenantId = (await pool.query('SELECT tenant_id FROM customers WHERE id=$1', [customerId])).rows[0]?.tenant_id ?? null
  const plan = row.plan as DeletionPlan | null
  const prechecks = row.due_marked_at ? await deletionPrechecks(pool, row, tenantId) : { checks: [], blocked_by: null }
  const restoreHoldUntil = (await pool.query("SELECT restored_at + make_interval(hours => $1) AS until FROM control_plane_state WHERE restored_at + make_interval(hours => $1) > now()", [TENANT_DELETION_HOLD_HOURS])).rows[0]?.until ?? null
  const steps = (await pool.query('SELECT * FROM tenant_deletion_steps WHERE request_id=$1 ORDER BY started_at NULLS LAST,step', [row.id])).rows
  return tenantDeletionRunSchema.parse({
    request: viewOf(row), enabled: mode.enabled, disabled_reason: mode.reason,
    restore_hold_until: iso(restoreHoldUntil),
    plan: plan ? { digest: row.plan_digest, database: plan.effect.database, host: plan.effect.host, backups: plan.effect.backupIds.length, restore_copies: plan.effect.restoreCopies.length, cards: plan.cardIds.length } : null,
    prechecks,
    steps: steps.map(step => ({ step: step.step, state: step.state, intent: step.intent, attempts: step.attempts, failures: step.failures, started_at: iso(step.started_at),
      finished_at: iso(step.finished_at), next_attempt_at: iso(step.next_attempt_at), error_code: step.error_code, evidence: step.evidence })),
  })
}
