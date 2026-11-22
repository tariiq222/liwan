import { describe, expect, it } from 'vitest'
import { sharedJobLocation, showsSharedBackups, startRefusalKey } from '../sharedBackups'

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
