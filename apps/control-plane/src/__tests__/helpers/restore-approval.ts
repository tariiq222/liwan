import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { actorLabel } from '../../admin-auth/grants.js'

/** One open restore approval for a verified backup and a new target database, as the restore suites need it. Nothing is restored. */
export async function insertRestoreApproval(pool: Pool, input: { backupId: string; controlTenantId: string; targetDatabase: string; actor: { issuer: string; actorUid: number } }): Promise<string> {
  const approvalId = randomUUID()
  await pool.query("INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at,approved_by) VALUES($1,$2,$3,$4,'Restore fixture approval',clock_timestamp()+interval '1 hour',$5)",
    [approvalId, input.backupId, input.controlTenantId, input.targetDatabase, actorLabel(input.actor)])
  return approvalId
}
