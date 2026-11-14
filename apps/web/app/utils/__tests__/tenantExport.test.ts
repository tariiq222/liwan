import { describe, expect, it } from 'vitest'
import { EXPORT_POLL_MS, exportErrorKey, exportFailureKey, exportProgress, exportWaiting, exportInProgress, exportRefreshDelay, exportRowsTotal, exportStateTone, isBranchIdentity } from '../tenantExport'

describe('tenant export helpers', () => {
  it('polls only while a job is queued or running, and never faster than every 15 seconds', () => {
    expect(EXPORT_POLL_MS).toBeGreaterThanOrEqual(15_000)
    expect(exportRefreshDelay([{ state: 'done' }, { state: 'running' }])).toBe(EXPORT_POLL_MS)
    expect(exportRefreshDelay([{ state: 'requested' }])).toBe(EXPORT_POLL_MS)
    expect(exportRefreshDelay([{ state: 'done' }, { state: 'failed' }, { state: 'expired' }])).toBe(false)
    expect(exportRefreshDelay([])).toBe(false)
    expect(exportRefreshDelay(undefined)).toBe(false)
    expect(exportInProgress([{ state: 'failed' }])).toBe(false)
  })
  it('gives every state a tone and sums the rows of all workbooks', () => {
    expect(exportStateTone('done')).toBe('success')
    expect(exportStateTone('failed')).toBe('destructive')
    expect(exportStateTone('expired')).toBe('neutral')
    expect(exportRowsTotal({ rows: { 'pmo.project': 3, 'hr.employee': 4 }, files: 2, file_bytes: 1, overflow_cells: 0 })).toBe(7)
  })
  it('treats only an explicit non-root company as a branch session', () => {
    expect(isBranchIdentity({ is_root_company: false })).toBe(true)
    expect(isBranchIdentity({ is_root_company: true })).toBe(false)
    expect(isBranchIdentity({})).toBe(false)
    expect(isBranchIdentity(null)).toBe(false)
  })
  it('names the refusal the user can act on', () => {
    expect(exportErrorKey({ status: 409, code: 'export_in_progress' })).toBe('inProgress')
    expect(exportErrorKey({ status: 429, code: 'rate_limited' })).toBe('cooldown')
    expect(exportErrorKey({ status: 403, code: 'forbidden' })).toBe('forbidden')
    expect(exportErrorKey({ status: 500, code: 'http_error' })).toBe('failed')
    expect(exportErrorKey(undefined)).toBe('failed')
  })
  it('shows progress, the cooldown and the failure code without relying on new fields', () => {
    expect(exportProgress({ steps_done: 1, steps_total: 4 })).toBe(25)
    expect(exportProgress({ steps_done: 9, steps_total: 4 })).toBe(100)
    expect(exportProgress({})).toBeNull()
    expect(exportProgress({ steps_done: 0, steps_total: 0 })).toBeNull()
    expect(exportWaiting('2030-01-02T00:00:00Z', Date.parse('2030-01-01T00:00:00Z'))).toBe(true)
    expect(exportWaiting('2030-01-02T00:00:00Z', Date.parse('2030-01-03T00:00:00Z'))).toBe(false)
    expect(exportWaiting(undefined, 0)).toBe(false)
    expect(exportFailureKey({ code: 'insufficient_disk' })).toBe('diskSpace')
    expect(exportFailureKey({ code: 'timeout' })).toBe('timeout')
    expect(exportFailureKey({ code: 'something_new' })).toBe('generic')
    expect(exportFailureKey(null)).toBe('generic')
  })
})
