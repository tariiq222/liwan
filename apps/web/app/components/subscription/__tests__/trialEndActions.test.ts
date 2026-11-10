import { describe, expect, it } from 'vitest'
import { trialEndActions } from '../../../utils/subscription'

describe('trial end customer actions', () => {
  it('keeps conversion available when the cutoff passed and the lapse has not run', () => {
    expect(trialEndActions('trial_ending', 'trialing', true)).toEqual({
      blocked: true, canConvert: true, canRetry: false,
    })
  })

  it('allows recovery instead of another purchase while the lock is pending', () => {
    expect(trialEndActions('lock_pending', 'active', true)).toEqual({
      blocked: true, canConvert: false, canRetry: true,
    })
  })

  it('offers no commercial mutations to a read-only user or suspended subscription', () => {
    for (const actions of [
      trialEndActions('lock_pending', 'active', false),
      trialEndActions('lock_pending', 'suspended', true),
      trialEndActions('trialing', 'trialing', false),
    ]) {
      expect(actions.canConvert).toBe(false)
      expect(actions.canRetry).toBe(false)
    }
  })

  it('leaves orders open when there is no lifecycle block', () => {
    expect(trialEndActions('settled', 'active', true).blocked).toBe(false)
    expect(trialEndActions(null, 'active', true).blocked).toBe(false)
  })
})
