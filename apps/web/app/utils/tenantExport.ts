import type { TenantExport } from '@liwan/contracts'

export type { TenantExport }

/** The calmest poll the page may use while a job is queued or running: never faster than every 15 seconds. */
export const EXPORT_POLL_MS = 20_000

export const TENANT_EXPORT_PATH = '/api/v1/admin/tenant-export'

/** The route a tenant uses to take a copy of its data; the bell row and the workspace-deletion panel point here. */
export const TENANT_EXPORT_PAGE = '/settings/system/export'

type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive'

const TONES: Record<TenantExport['state'], Tone> = {
  requested: 'info',
  running: 'info',
  done: 'success',
  failed: 'destructive',
  expired: 'neutral',
}

export const exportStateTone = (state: TenantExport['state']): Tone => TONES[state]

/** A job is in progress while it is queued or running; the server refuses a second request then. */
export const exportInProgress = (items: readonly Pick<TenantExport, 'state'>[] | undefined): boolean =>
  (items ?? []).some(item => item.state === 'requested' || item.state === 'running')

/** How often to re-read the list: only while something is in progress, otherwise never. */
export const exportRefreshDelay = (items: readonly Pick<TenantExport, 'state'>[] | undefined): number | false =>
  exportInProgress(items) ? EXPORT_POLL_MS : false

/** Every row of every workbook, summed. */
export const exportRowsTotal = (counts: NonNullable<TenantExport['counts']>): number =>
  Object.values(counts.rows).reduce((sum, value) => sum + value, 0)

/** The export page is for the root company only; a session of a branch gets the "main company" state. */
export const isBranchIdentity = (identity: { is_root_company?: boolean } | null | undefined): boolean => identity?.is_root_company === false

/** The percentage of a running build that is done, or null when the server does not report steps. */
export function exportProgress(job: Partial<Pick<TenantExport, 'steps_done' | 'steps_total'>>): number | null {
  const { steps_done: done, steps_total: total } = job
  return typeof done === 'number' && typeof total === 'number' && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
}

/** Whether a request must wait: the next export is possible only at `next` (after the cooldown that follows a finished one). */
export const exportWaiting = (next: string | null | undefined, now: number): boolean => !!next && Date.parse(next) > now

const FAILURES = { insufficient_disk: 'diskSpace', timeout: 'timeout', build_failed: 'buildFailed', requester_not_authorized: 'notAuthorized' } as const
type FailureKey = (typeof FAILURES)[keyof typeof FAILURES] | 'generic'
/** The settings locale key (under `settings.tenantExport.failures`) of a failed build's fixed code; an unknown code is generic. */
export const exportFailureKey = (failure: { code?: string } | null | undefined): FailureKey =>
  (FAILURES as Record<string, FailureKey>)[failure?.code ?? ''] ?? 'generic'

/** The settings locale key (under `settings.tenantExport.errors`) that tells the user why a request or a download was refused. */
export function exportErrorKey(error: unknown): 'inProgress' | 'cooldown' | 'forbidden' | 'failed' {
  const { status, code } = (error ?? {}) as { status?: number; code?: string }
  if (code === 'export_in_progress') return 'inProgress'
  if (status === 429 || code === 'export_cooldown') return 'cooldown'
  if (status === 403) return 'forbidden'
  return 'failed'
}
