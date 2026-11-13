import type { Pool } from 'pg'
import { tenantDeletionRequestSchema, tenantDeletionSchema, type TenantDeletion, type TenantDeletionRequest } from '@liwan/commercial-contracts'

const iso = (value: Date | string | null): string | null => value === null ? null : value instanceof Date ? value.toISOString() : value
/** The states of a request that has not ended: asked, confirmed or due. A customer has at most one. */
export const OPEN_DELETION_STATES = ['requested', 'confirmed', 'due']

/** SQL: the customer named by `customerColumn` has a deletion whose clock is running (confirmed or due). A paid period is never opened for it. */
export const deletionClockRunningSql = (customerColumn: string) =>
  `EXISTS (SELECT 1 FROM tenant_deletion_requests d WHERE d.customer_id=${customerColumn} AND d.state IN ('confirmed','due'))`

/** What the tenant sees of its open request, or null. */
export async function tenantDeletionOf(pool: Pick<Pool, 'query'>, customerId: string): Promise<TenantDeletion | null> {
  const row = (await pool.query(`SELECT * FROM tenant_deletion_requests WHERE customer_id=$1 AND state=ANY($2::text[])`, [customerId, OPEN_DELETION_STATES])).rows[0]
  return row ? tenantDeletionSchema.parse({ state: row.state, requested_at: iso(row.requested_at), code_expires_at: iso(row.code_expires_at),
    confirmed_at: iso(row.confirmed_at), due_at: iso(row.due_at) }) : null
}

const viewOf = (row: Record<string, any>): TenantDeletionRequest => tenantDeletionRequestSchema.parse({
  id: row.id, customer_id: row.customer_id, state: row.state, requested_at: iso(row.requested_at), requested_by: row.requested_by,
  confirmed_at: iso(row.confirmed_at), due_at: iso(row.due_at), due_marked_at: iso(row.due_marked_at),
  withdrawn_at: iso(row.withdrawn_at), withdrawn_by: row.withdrawn_by, withdraw_reason: row.withdraw_reason,
  renewal_outcome: row.renewal_outcome, renewal_refusal: row.renewal_refusal,
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

