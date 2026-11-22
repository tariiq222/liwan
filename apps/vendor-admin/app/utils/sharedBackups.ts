import type { SharedBackupList } from '@liwan/commercial-contracts'
import type { VendorTenant } from '@/utils/vendorTenant'

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
