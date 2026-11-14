import { describe, expect, it } from 'vitest'
import type { SubscriptionView } from '@liwan/commercial-contracts'
import { hasTrialPreview, trialEndActions } from '../../../utils/subscription'

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

describe('trial end preview availability', () => {
  const sub = (fields: Partial<SubscriptionView>) => ({ applied: {}, trial_ends_at: null, trial_outcome: null, ...fields }) as SubscriptionView

  it('fetches the preview during an unresolved trial lock although trial_ends_at is cleared and no outcome is set', () => {
    expect(hasTrialPreview(sub({ pending_free_base_lock: 'trial_end' }))).toBe(true)
    expect(hasTrialPreview(sub({ pending_free_base_lock: 'first_invoice_unpaid' }))).toBe(true)
  })

  it('does not open it for the refund lock of a subscription that never had a trial', () => {
    expect(hasTrialPreview(sub({ pending_free_base_lock: 'refund' }))).toBe(false)
    expect(hasTrialPreview(sub({ pending_free_base_lock: 'refund', trial_outcome: 'converted' }))).toBe(true)
  })

  it('fetches it while a trial runs or after it settles, and not for an ordinary subscription', () => {
    expect(hasTrialPreview(sub({ trial_ends_at: '2026-12-01T21:00:00Z' }))).toBe(true)
    expect(hasTrialPreview(sub({ trial_outcome: 'free_base' }))).toBe(true)
    expect(hasTrialPreview(sub({ pending_free_base_lock: null }))).toBe(false)
    expect(hasTrialPreview(null)).toBe(false)
  })
})
