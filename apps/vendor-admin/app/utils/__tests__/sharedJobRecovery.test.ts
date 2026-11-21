import { describe, expect, it } from 'vitest'
import { canRecoverJob } from '../sharedJobRecovery'

describe('recover control for a stuck shared job', () => {
  const stuck = { source: 'shared', type: 'provision', status: 'needs_intervention', recovery: null }
  const run = (capability: string) => capability === 'vendor.operations.run'
  it('is offered for a stuck provision, backup or restore to an operator who may run operations', () => {
    for (const type of ['provision', 'backup', 'restore']) expect(canRecoverJob({ ...stuck, type }, run)).toBe(true)
    expect(canRecoverJob(stuck, () => false)).toBe(false)
  })
  it('is not offered for reconfigure or unknown jobs, or jobs that are not stuck', () => {
    for (const type of ['reconfigure', 'unknown']) expect(canRecoverJob({ ...stuck, type }, run)).toBe(false)
    for (const status of ['queued', 'running', 'verified', 'failed']) expect(canRecoverJob({ ...stuck, status }, run)).toBe(false)
    expect(canRecoverJob({ ...stuck, source: 'legacy' }, run)).toBe(false)
    expect(canRecoverJob(null, run)).toBe(false)
  })
  it('waits for a pending request, and allows asking again after it ended', () => {
    expect(canRecoverJob({ ...stuck, recovery: { state: 'pending' } }, run)).toBe(false)
    for (const state of ['verified', 'still_needs_intervention', 'failed']) expect(canRecoverJob({ ...stuck, recovery: { state } }, run)).toBe(true)
  })
})
