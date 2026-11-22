import type { Pool } from 'pg'
import { z } from 'zod'
import { findBlockingJob } from './job-store.js'

/** The most backups one listing returns; `total` still counts them all. */
export const BACKUP_LIST_LIMIT = 100

type StartRefusal = 'operations_unavailable' | 'job_in_progress'

/**
 * What the vendor console may know about a workspace's backups: ids, times, display names and states. Never the artifact
 * path, a digest, a database name or a binding, and never another workspace's rows (every query is scoped to one tenant).
 *
 * A backup is listed only once it is verified: the record exists after the readback check and its job is `verified`.
 * An approval counts as usable only while it is unconsumed, unexpired and no restore job was queued from it, which is the
 * exact condition under which `enqueueSharedJob` accepts it.
 *
 * Starting a backup is a short outage for every workspace on the shared stack, not only this one. The worker
 * (`tools/shared_saas_lifecycle/odoo_backup.py`, `capture`) refuses a project with a running effect container, then runs
 * `compose stop odoo`, checks that Odoo stopped and no writer session remains, dumps the database and filestore, and runs
 * `compose start odoo` and waits for it to be healthy. When release routes are enabled the capture goes through the
 * tenant-only release quiescence instead (`release_backup.py`); the stop of the shared service is the default path.
 */
export async function listSharedBackups(pool: Pool, controlTenantId: string) {
  z.uuid().parse(controlTenantId)
  const tenant = await pool.query("SELECT (commercial_mode='saas' AND operations_enabled) AS operable FROM tenants WHERE id=$1", [controlTenantId])
  if (!tenant.rowCount) return null
  const blocking = await findBlockingJob(pool, controlTenantId, { aiPush: false })
  const refusal: StartRefusal | null = !tenant.rows[0].operable ? 'operations_unavailable' : blocking ? 'job_in_progress' : null
  const backups = await pool.query(`SELECT b.id AS backup_id, m.job_id, b.created_at, va.display_name AS started_by,
      ap.id AS approval_id, ap.expires_at, ap.approver, count(*) OVER () AS total
    FROM shared_backups b
    JOIN shared_odoo_backups m ON m.backup_id=b.id
    JOIN shared_jobs j ON j.id=m.job_id AND j.state='verified'
    LEFT JOIN vendor_accounts va ON 'account:'||va.id=b.created_by
    LEFT JOIN LATERAL (
      SELECT a.id,a.expires_at,ab.display_name AS approver FROM shared_restore_approvals a
      LEFT JOIN vendor_accounts ab ON 'account:'||ab.id=a.approved_by
      WHERE a.backup_id=b.id AND a.control_tenant_id=b.control_tenant_id AND a.consumed_at IS NULL AND a.expires_at>clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM shared_jobs r WHERE r.control_tenant_id=a.control_tenant_id AND r.payload->>'operation'='restore' AND r.payload->>'approvalId'=a.id::text)
      ORDER BY a.created_at DESC LIMIT 1
    ) ap ON true
    WHERE b.control_tenant_id=$1 AND b.consistency='verified'
    ORDER BY b.created_at DESC, b.id LIMIT ${BACKUP_LIST_LIMIT}`, [controlTenantId])
  const ids = backups.rows.map(row => row.backup_id as string)
  const restores = ids.length ? await pool.query(`SELECT a.backup_id, a.id AS approval_id, r.id AS job_id, r.state, r.created_at
    FROM shared_restore_approvals a
    JOIN shared_jobs r ON r.control_tenant_id=a.control_tenant_id AND r.payload->>'operation'='restore' AND r.payload->>'approvalId'=a.id::text
    WHERE a.control_tenant_id=$1 AND a.backup_id=ANY($2::uuid[]) ORDER BY r.created_at DESC, r.id`, [controlTenantId, ids]) : { rows: [] }
  const iso = (value: Date) => new Date(value).toISOString()
  return {
    start: { allowed: refusal === null, reason: refusal, job_id: refusal === 'job_in_progress' ? blocking : null },
    total: backups.rowCount ? Number(backups.rows[0].total) : 0,
    items: backups.rows.map(row => ({
      backup_id: row.backup_id as string,
      job_id: row.job_id as string,
      created_at: iso(row.created_at),
      started_by: (row.started_by ?? null) as string | null,
      approval: row.approval_id ? { approval_id: row.approval_id as string, expires_at: iso(row.expires_at), approved_by: (row.approver ?? null) as string | null } : null,
      restores: restores.rows.filter(restore => restore.backup_id === row.backup_id).map(restore => ({
        job_id: restore.job_id as string, approval_id: restore.approval_id as string, state: restore.state as string, created_at: iso(restore.created_at),
      })),
    })),
  }
}
