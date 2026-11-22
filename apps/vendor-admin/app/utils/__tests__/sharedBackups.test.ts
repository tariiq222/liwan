import { describe, expect, it } from 'vitest'
import { backupJobRequest, sharedBackupErrorKey, sharedJobLocation, showsSharedBackups, startRefusalKey } from '../sharedBackups'
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
