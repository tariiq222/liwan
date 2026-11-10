import { describe, expect, it } from 'vitest'
import { canAbandonJob } from '../sharedJobAbandon'

describe('abandon control for a stuck shared job', () => {
  const stuck = { source: 'shared', type: 'backup', status: 'needs_intervention', abandonment: null }
  const run = (capability: string) => capability === 'vendor.operations.run'
  it('is offered for a stuck backup or restore to an operator who may run operations', () => {
    expect(canAbandonJob(stuck, run)).toBe(true)
    expect(canAbandonJob({ ...stuck, type: 'restore' }, run)).toBe(true)
    expect(canAbandonJob(stuck, () => false)).toBe(false)
  })
  it('is not offered for operations where abandoning is unsafe, or jobs that are not stuck', () => {
    for (const type of ['provision', 'reconfigure', 'unknown']) expect(canAbandonJob({ ...stuck, type }, run)).toBe(false)
    for (const status of ['queued', 'running', 'verified', 'failed']) expect(canAbandonJob({ ...stuck, status }, run)).toBe(false)
    expect(canAbandonJob({ ...stuck, source: 'legacy' }, run)).toBe(false)
    expect(canAbandonJob(null, run)).toBe(false)
  })
  it('waits for a pending request, and allows asking again after a refusal', () => {
    expect(canAbandonJob({ ...stuck, abandonment: { state: 'pending' } }, run)).toBe(false)
    for (const state of ['effect_present', 'failed']) expect(canAbandonJob({ ...stuck, abandonment: { state } }, run)).toBe(true)
  })
})
