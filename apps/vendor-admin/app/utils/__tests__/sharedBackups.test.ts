import { describe, expect, it, vi } from 'vitest'
import { approvalUsable, backupJobRequest, restoreFromBackup, RestoreQueueFailed, restoreJobRequest, sharedBackupErrorKey, sharedJobLocation, showsSharedBackups, startRefusalKey } from '../sharedBackups'
import { StepUpCancelled, STEP_UP_CANCELLED_KEY } from '../../composables/useStepUp'

const job = '10000000-0000-4000-8000-000000000001'

describe('shared backups helpers', () => {
  it('shows the section for a shared workspace only', () => {
    expect(showsSharedBackups({ hosting_model: 'shared_managed' })).toBe(true)
    for (const hosting_model of ['dedicated_managed', 'customer_hosted'] as const) expect(showsSharedBackups({ hosting_model })).toBe(false)
    expect(showsSharedBackups(null)).toBe(false)
    expect(showsSharedBackups(undefined)).toBe(false)
  })
  it('words each refusal of a new backup and says nothing when it can start', () => {
    expect(startRefusalKey({ allowed: true, reason: null, job_id: null })).toBeNull()
    expect(startRefusalKey({ allowed: false, reason: 'operations_unavailable', job_id: null })).toBe('vendor.backups.refusal.operations_unavailable')
    expect(startRefusalKey({ allowed: false, reason: 'job_in_progress', job_id: job })).toBe('vendor.backups.refusal.job_in_progress')
  })
  it('links a job to the shared operation page', () => {
    expect(sharedJobLocation(job)).toEqual({ path: `/operations/${job}`, query: { source: 'shared' } })
  })
})

describe('shared backup requests and errors', () => {
  it('builds the backup request from a request id and a trimmed reason only', () => {
    expect(backupJobRequest(job, '  Before the upgrade ')).toEqual({ reason: 'Before the upgrade', job: { schemaVersion: 1, requestId: job, operation: 'backup' } })
  })
  it.each([
    [409, 'shared_reconciliation_required'], [409, 'tenant_operations_unavailable'], [409, 'tenant_unavailable'], [403, 'shared_job_forbidden'], [403, 'forbidden'],
    [409, 'shared_replay_forbidden'], [409, 'idempotency_conflict'], [503, 'vendor_unavailable'], [422, 'invalid'],
  ])('maps the %s answer %s to its own text', (statusCode, code) => {
    expect(sharedBackupErrorKey({ statusCode, data: { code } })).toBe(`vendor.backups.errors.${code}`)
  })
  it('falls back to the generic text, and words a cancelled step-up as the person\'s own choice', () => {
    expect(sharedBackupErrorKey({ statusCode: 500, data: { code: 'something_new' } })).toBe('vendor.backups.errors.generic')
    expect(sharedBackupErrorKey(new Error('boom'))).toBe('vendor.backups.errors.generic')
    expect(sharedBackupErrorKey(new StepUpCancelled())).toBe(STEP_UP_CANCELLED_KEY)
  })
})

describe('restoring a backup', () => {
  const backup = '10000000-0000-4000-8000-000000000002'
  const approval = '10000000-0000-4000-8000-000000000003'
  const input = { tenantId: job, backupId: backup, reason: ' Restore check ', requestId: '10000000-0000-4000-8000-000000000004' }
  const calls = () => {
    const log: Array<{ path: string; options: unknown }> = []
    const request = vi.fn(async (path: string, options?: unknown) => { log.push({ path, options }); return path.endsWith('restore-approvals') ? { approval_id: approval, expires_at: 'x' } : { id: '10000000-0000-4000-8000-000000000005' } })
    return { log, request: request as unknown as Parameters<typeof restoreFromBackup>[0] }
  }
  it('builds the restore job from an approval id only', () => {
    expect(restoreJobRequest(input.requestId, approval, ' Restore check ')).toEqual({ reason: 'Restore check', job: { schemaVersion: 1, requestId: input.requestId, operation: 'restore', approvalId: approval } })
  })
  it('approves first, then queues the job for that approval, with the same trimmed reason', async () => {
    const { log, request } = calls()
    expect(await restoreFromBackup(request, input)).toEqual({ approvalId: approval, jobId: '10000000-0000-4000-8000-000000000005' })
    expect(log.map(call => call.path)).toEqual([`shared/tenants/${job}/restore-approvals`, `shared/tenants/${job}/jobs`])
    expect(log[0]!.options).toEqual({ method: 'POST', body: { backup_id: backup, reason: 'Restore check' } })
    expect(log[1]!.options).toEqual({ method: 'POST', body: restoreJobRequest(input.requestId, approval, 'Restore check') })
  })
  it('resumes an open approval with the job call alone', async () => {
    const { log, request } = calls()
    await restoreFromBackup(request, { ...input, approvalId: approval })
    expect(log.map(call => call.path)).toEqual([`shared/tenants/${job}/jobs`])
  })
  it('stops after a failed approval, and carries the approval id when only the job call failed', async () => {
    const failure = { statusCode: 409, data: { code: 'shared_backup_unavailable' } }
    const first = vi.fn(async () => { throw failure })
    await expect(restoreFromBackup(first as never, input)).rejects.toBe(failure)
    expect(first).toHaveBeenCalledTimes(1)
    const second = vi.fn(async (path: string) => { if (path.endsWith('/jobs')) throw failure; return { approval_id: approval } })
    const error = await restoreFromBackup(second as never, input).catch(cause => cause) as RestoreQueueFailed
    expect(error).toBeInstanceOf(RestoreQueueFailed); expect(error.approvalId).toBe(approval); expect(error.original).toBe(failure)
  })
  it('counts an approval as usable until it expires', () => {
    const open = { approval_id: approval, expires_at: '2026-11-22T11:00:00.000Z', approved_by: null }
    const at = Date.parse(open.expires_at)
    expect([approvalUsable(open, at - 1), approvalUsable(open, at), approvalUsable(open, at + 1), approvalUsable(null, 0)]).toEqual([true, false, false, false])
  })
  it('words the refusals of the restore calls', () => {
    for (const code of ['shared_backup_unavailable', 'shared_restore_approval_unavailable', 'restore_target_reserved', 'shared_artifact_mismatch'])
      expect(sharedBackupErrorKey({ statusCode: 409, data: { code } })).toBe(`vendor.backups.errors.${code}`)
  })
})
