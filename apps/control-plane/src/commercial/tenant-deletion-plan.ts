import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'

/** SQL: the dedupe key of the `type` notice of the hold the request row `alias` is in (hold 1 has the bare key, later holds carry their number). */
export const noticeKeySql = (type: string, alias: string) => `CASE WHEN ${alias}.hold_notice_seq = 1 THEN '${type}:' || ${alias}.id ELSE '${type}:' || ${alias}.id || ':' || ${alias}.hold_notice_seq END`
/** The dedupe key of a hold's notice in application code (the same rule). */
export const noticeKey = (type: string, id: string, seq: number) => seq === 1 ? `${type}:${id}` : `${type}:${id}:${seq}`

type Queryable = Pick<PoolClient, 'query'>

/** The plan the Python effects receive (`tools/shared_saas_lifecycle/tenant_drop_effect.py`): exactly these keys, nothing else. */
export type EffectPlan = {
  schemaVersion: 1; requestId: string; controlTenantId: string; tenantId: string; database: string; filestore: string; host: string
  customerName: string; controlPlaneDatabase: string; restoreCopies: string[]; backupIds: string[]
}
/** Everything the runner will touch, frozen when the request becomes `deleting`: names and ids only, never a secret. */
export type DeletionPlan = { effect: EffectPlan; cardIds: string[]; relay: { tenantId: string }; offsite: { prefix: string } }
export type Precheck = { code: string; ok: boolean }

/** Canonical JSON as the effects hash it: keys sorted, no whitespace, non-ASCII kept as UTF-8. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
export const planDigestOf = (value: unknown): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')

/** The checks a request must pass before its plan is frozen, in order. A failed check defers the deletion; nothing here ever fails it. */
const CHECKS: { code: string; sql: string }[] = [
  { code: 'due_notice_delivered', sql: `EXISTS (SELECT 1 FROM commercial_outbox o JOIN tenant_deletion_requests r ON r.id::text=o.aggregate_id WHERE o.kind='tenant_deletion.notice' AND o.aggregate_id=$3::text
      AND o.status='done' AND o.payload->>'delivered'='true' AND o.dedupe_key=${noticeKeySql('due', 'r')})` },
  { code: 'no_payment_in_flight', sql: `NOT EXISTS (SELECT 1 FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.customer_id=$1
      AND (a.status='unknown' OR (a.status IN ('created','redirected','pending') AND a.updated_at > now() - interval '24 hours') OR a.payment_hold_until > now()))` },
  { code: 'no_payment_after_due', sql: `NOT EXISTS (SELECT 1 FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.customer_id=$1 AND a.status='succeeded'
      AND a.succeeded_at > $4::timestamptz AND o.payment_state <> 'refunded')` },
  { code: 'no_charging_renewal', sql: `NOT EXISTS (SELECT 1 FROM renewals r JOIN orders o ON o.id=r.order_id WHERE o.customer_id=$1 AND r.status='charging')` },
  { code: 'no_unfulfilled_order', sql: `NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=$1 AND NOT o.cancelled AND o.payment_state='paid'
      AND o.fulfillment_state IN ('queued','applying','failed','needs_intervention'))` },
  { code: 'no_free_base_lock', sql: `NOT EXISTS (SELECT 1 FROM free_base_locks f JOIN subscriptions s ON s.id=f.subscription_id WHERE s.customer_id=$1 AND f.state IN ('pending','ordered'))` },
  { code: 'no_shared_job', sql: `NOT EXISTS (SELECT 1 FROM shared_jobs WHERE control_tenant_id=$2 AND state IN ('queued','running','needs_intervention'))` },
  { code: 'no_restore_pending', sql: `NOT EXISTS (SELECT 1 FROM shared_restore_approvals WHERE control_tenant_id=$2 AND consumed_at IS NULL AND expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM shared_restore_publications WHERE control_tenant_id=$2 AND status='queued')` },
  { code: 'binding_found', sql: `EXISTS (SELECT 1 FROM shared_registry_bindings WHERE control_tenant_id=$2)` },
]
/** Deferrals that need the vendor at once (money moved after the window ended); every other deferral alerts only when it lasts 24 hours. */
export const IMMEDIATE_ALERT_CHECKS: readonly string[] = ['no_payment_after_due']

export async function deletionPrechecks(client: Queryable, request: { id: string; customer_id: string; due_marked_at: Date }, tenantId: string | null): Promise<{ checks: Precheck[]; blocked_by: string | null }> {
  const checks: Precheck[] = []
  for (const check of CHECKS) {
    // The prefix types all four parameters for every check, whichever of them the check uses.
    const ok = (await client.query(`SELECT ($1::uuid IS NULL OR true) AND ($2::uuid IS NULL OR true) AND ($3::text IS NULL OR true) AND ($4::timestamptz IS NULL OR true) AND ${check.sql} AS ok`, [request.customer_id, tenantId, request.id, request.due_marked_at])).rows[0].ok === true
    checks.push({ code: check.code, ok })
  }
  return { checks, blocked_by: checks.find(c => !c.ok)?.code ?? null }
}

/** The frozen plan, read from the registry binding derived from `customers.tenant_id` and the records that name what must go. */
export async function buildDeletionPlan(client: Queryable, request: { id: string; customer_id: string }): Promise<DeletionPlan> {
  const customer = (await client.query(`SELECT c.name,c.tenant_id,b.tenant_id AS registry_tenant,b.host,b.database_name,b.filestore,current_database() AS control_db
    FROM customers c JOIN shared_registry_bindings b ON b.control_tenant_id=c.tenant_id WHERE c.id=$1`, [request.customer_id])).rows[0]
  if (!customer) throw new Error('binding_unavailable')
  const ids = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows.map(r => String(r.v))
  return {
    effect: {
      schemaVersion: 1, requestId: request.id, controlTenantId: customer.tenant_id, tenantId: customer.registry_tenant, database: customer.database_name, filestore: customer.filestore,
      host: customer.host, customerName: customer.name, controlPlaneDatabase: customer.control_db,
      restoreCopies: await ids('SELECT DISTINCT target_database AS v FROM shared_restore_approvals WHERE control_tenant_id=$1 ORDER BY 1', [customer.tenant_id]),
      backupIds: await ids('SELECT id AS v FROM shared_backups WHERE control_tenant_id=$1 AND purged_at IS NULL ORDER BY id', [customer.tenant_id]),
    },
    cardIds: await ids("SELECT id AS v FROM payment_methods WHERE customer_id=$1 AND status<>'removed' ORDER BY id", [request.customer_id]),
    relay: { tenantId: customer.registry_tenant },
    offsite: { prefix: customer.registry_tenant },
  }
}
