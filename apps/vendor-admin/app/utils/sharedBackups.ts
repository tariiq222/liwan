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

// Every code the control plane can answer a backup start with (apps/control-plane/src/http.ts, shared/job-store.ts) plus the
// masked outage the vendor proxy answers for any 5xx.
const ERROR_CODES = new Set(['shared_reconciliation_required', 'tenant_operations_unavailable', 'tenant_unavailable', 'shared_job_forbidden', 'forbidden', 'shared_replay_forbidden', 'idempotency_conflict', 'vendor_unavailable', 'invalid'])

/** The text for a failed call of this flow: the cancelled step-up's own text, a known refusal's, else the generic one. */
export function sharedBackupErrorKey(cause: unknown): string {
  const code = commercialFailure(cause).code
  return failureKey(cause, ERROR_CODES.has(code) ? `vendor.backups.errors.${code}` : 'vendor.backups.errors.generic')
}
