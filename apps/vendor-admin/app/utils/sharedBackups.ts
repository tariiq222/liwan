import type { SharedBackupList } from '@liwan/commercial-contracts'
import type { VendorTenant } from './vendorTenant'
import { commercialFailure } from './vendorCommercial'
import { failureKey } from '../composables/useStepUp'

export type SharedBackupItem = SharedBackupList['items'][number]
export type SharedBackupStart = SharedBackupList['start']

/** The backups section is for workspaces on the shared stack; a dedicated installation keeps its own operations form. */
export const showsSharedBackups = (tenant: Pick<VendorTenant, 'hosting_model'> | null | undefined): boolean => tenant?.hosting_model === 'shared_managed'

const REFUSAL_KEYS = {
  operations_unavailable: 'vendor.backups.refusal.operations_unavailable',
  job_in_progress: 'vendor.backups.refusal.job_in_progress',
} as const

/** The text for why a backup cannot be started now (none when it can). */
export const startRefusalKey = (start: SharedBackupStart): string | null => (start.allowed ? null : REFUSAL_KEYS[start.reason])

/** The operation page of one shared job (the backup being made, a restore, or the job that blocks a new backup). */
export const sharedJobLocation = (jobId: string) => ({ path: `/operations/${encodeURIComponent(jobId)}`, query: { source: 'shared' } })

/**
 * The body that queues a backup. The browser sends only a request id and a reason: the binding, the digests and the
 * target are derived on the server. The same request id is sent again on a retry, so a lost answer never makes a second backup.
 */
export const backupJobRequest = (requestId: string, reason: string) => ({ reason: reason.trim(), job: { schemaVersion: 1, requestId, operation: 'backup' } })

// Every code the control plane can answer a backup start or a restore with (apps/control-plane/src/http.ts, shared/job-store.ts) plus the
// masked outage the vendor proxy answers for any 5xx.
const ERROR_CODES = new Set(['shared_backup_unavailable', 'shared_restore_approval_unavailable', 'restore_target_reserved', 'shared_artifact_mismatch', 'shared_reconciliation_required', 'tenant_operations_unavailable', 'tenant_unavailable', 'shared_job_forbidden', 'forbidden', 'shared_replay_forbidden', 'idempotency_conflict', 'vendor_unavailable', 'invalid'])

/** The text for a failed call of this flow: the cancelled step-up's own text, a known refusal's, else the generic one. */
export function sharedBackupErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return failureKey(cause, ERROR_CODES.has(code) ? `vendor.backups.errors.${code}` : 'vendor.backups.errors.generic')
}

/** The body that queues the restore of one approval. The server derives the binding, the backup and the target from the approval. */
export const restoreJobRequest = (requestId: string, approvalId: string, reason: string) => ({ reason: reason.trim(), job: { schemaVersion: 1, requestId, operation: 'restore', approvalId } })

/** An approval can still start a restore while it has not expired (the server refuses an expired one). */
export const approvalUsable = (approval: SharedBackupItem['approval'], now: number): boolean => Boolean(approval) && Date.parse(approval!.expires_at) > now

/** The server refused the approval a restore named (expired, used or unknown): the approval is gone, so the next restore approves afresh. */
export const approvalRefused = (cause: unknown): boolean => commercialFailure(cause).code === 'shared_restore_approval_unavailable'

/** The approval exists but queuing the restore failed: the approval stays open and can be resumed. */
export class RestoreQueueFailed extends Error {
  constructor(readonly approvalId: string, readonly original: unknown) {
    super('restore_queue_failed')
    this.name = 'RestoreQueueFailed'
  }
}

type Call = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>

/**
 * Restores one backup to a separate copy: approve it (unless an open approval is given), then queue the restore job. The two
 * calls run in that order, each after its own fresh passkey check. A failure of the second leaves the approval open: the
 * error carries its id so the caller can resume it instead of approving again.
 */
export async function restoreFromBackup(request: Call, input: { tenantId: string; backupId: string; reason: string; requestId: string; approvalId?: string | null }): Promise<{ approvalId: string; jobId: string }> {
  const base = `shared/tenants/${encodeURIComponent(input.tenantId)}`
  const approvalId = input.approvalId
    ?? (await request<{ approval_id: string }>(`${base}/restore-approvals`, { method: 'POST', body: { backup_id: input.backupId, reason: input.reason.trim() } })).approval_id
  try {
    const job = await request<{ id: string }>(`${base}/jobs`, { method: 'POST', body: restoreJobRequest(input.requestId, approvalId, input.reason) })
    return { approvalId, jobId: job.id }
  } catch (cause) { throw new RestoreQueueFailed(approvalId, cause) }
}
