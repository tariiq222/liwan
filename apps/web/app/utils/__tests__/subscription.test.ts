import { describe, expect, it, vi } from 'vitest'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { csrfTokenFor, formatSubscriptionMoney, FREE_BASE_BADGE, isStaleTrialCheckout, orderOutcome, payKindKey, refusalCode, refusalKey, sameQuoteEconomics, trialDaysRemaining } from '../subscription'

const money = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const t = (key: string) => `t:${key}`
describe('refusalCode', () => {
  it('reads the body the BFF createError produces, at either nesting level', () => {
    expect(refusalCode({ data: { data: { code: 'tenant_upgrade_required' } } })).toBe('tenant_upgrade_required')
    expect(refusalCode({ data: { code: 'tenant_binding_unavailable' } })).toBe('tenant_binding_unavailable')
    expect(refusalCode(new Error('x'))).toBeNull()
    expect(refusalKey(refusalCode({ data: { data: { code: 'tenant_upgrade_required' } } }))).toBe('subscription.trial.upgradeRequired')
  })
})

describe('refusalKey', () => {
  it('explains an unupgraded tenant and an unbound push, and ignores unrelated codes', () => {
    expect(refusalKey('tenant_upgrade_required')).toBe('subscription.trial.upgradeRequired')
    expect(refusalKey('tenant_binding_unavailable')).toBe('subscription.trial.notConfigured')
    expect(refusalKey('revision_conflict')).toBeNull()
  })
})

describe('sameQuoteEconomics', () => {
  const base: Record<string, unknown> = {
    id: 'q1', plan_revision_id: 'p', bundle_revision_ids: ['b'], terms_revision_id: null,
    cadence: { unit: 'month', count: 1 }, requested_users: 3, requested_storage_mb: 1024,
    requested_extra_branches: 0, due_now: money(100), next_renewal: money(200),
    lines: [{ kind: 'base', key: 'base', amount: money(100), quantity: 1 }],
  }
  it('ignores a new expiry and quote id', () => {
    expect(sameQuoteEconomics(base as never, { ...base, id: 'q2', expires_at: '2030-01-01' } as never)).toBe(true)
  })
  it('detects a real price or quantity change', () => {
    expect(sameQuoteEconomics(base as never, { ...base, due_now: money(101) } as never)).toBe(false)
    expect(sameQuoteEconomics(base as never, { ...base, requested_users: 4 } as never)).toBe(false)
  })
})

describe('order outcome on the payment return page', () => {
  it('maps every open order state to what the customer should see', () => {
    expect(orderOutcome({ payment_state: 'awaiting_payment', fulfillment_state: 'not_started' })).toBe('awaiting_payment')
    expect(orderOutcome({ payment_state: 'paid', fulfillment_state: 'queued' })).toBe('processing')
    expect(orderOutcome({ payment_state: 'paid', fulfillment_state: 'applying' })).toBe('processing')
    expect(orderOutcome({ payment_state: 'not_required', fulfillment_state: 'queued' })).toBe('processing')
    expect(orderOutcome({ payment_state: 'paid', fulfillment_state: 'failed' })).toBe('recovering')
    expect(orderOutcome({ payment_state: 'paid', fulfillment_state: 'needs_intervention' })).toBe('recovering')
    expect(orderOutcome({ payment_state: 'not_required', fulfillment_state: 'needs_intervention' })).toBe('activation_failed')
    expect(orderOutcome({ payment_state: 'paid', fulfillment_state: 'failed', cancelled: true })).toBe('activation_failed')
    expect(orderOutcome({ payment_state: 'refund_pending', fulfillment_state: 'not_started' })).toBe('refund')
    expect(orderOutcome({ payment_state: 'refunded', fulfillment_state: 'not_started' })).toBe('refund')
    expect(orderOutcome({ payment_state: 'paid', fulfillment_state: 'applied' })).toBe('applied')
    expect(orderOutcome({ payment_state: 'awaiting_payment', fulfillment_state: 'not_started', cancelled: true })).toBe('cancelled')
    expect(orderOutcome({ payment_state: 'paid', fulfillment_state: 'applied', cancelled: false })).toBe('applied')
    // A refund after activation or after a failed activation keeps fulfillment_state; the refund is what counts.
    expect(orderOutcome({ payment_state: 'refunded', fulfillment_state: 'applied' })).toBe('refund')
    expect(orderOutcome({ payment_state: 'refund_pending', fulfillment_state: 'failed' })).toBe('refund')
  })
})
describe('subscription dates', () => {
  it('trial days left never go negative and count Riyadh calendar days', () => {
    const now = new Date('2026-10-27T10:00:00Z')
    expect(trialDaysRemaining('2026-10-30T10:00:00Z', now)).toBe(3)
    expect(trialDaysRemaining('2026-10-20T10:00:00Z', now)).toBe(0)
    expect(trialDaysRemaining(null, now)).toBeNull()
  })
  it('renewal day and trial end use the app date format, not raw ISO', () => {
    expect(formatDate('2026-11-05')).toContain('05/11/2026')
    expect(formatDate('2026-10-30T22:30:00Z', 'Asia/Riyadh')).toContain('31/10/2026')
  })
})

describe('csrfTokenFor', () => {
  it('reuses the cookie the browser already holds', async () => {
    const fetchCookie = vi.fn()
    expect(await csrfTokenFor('abc', fetchCookie, () => 'other')).toBe('abc')
    expect(fetchCookie).not.toHaveBeenCalled()
  })
  it('asks the browser for the cookie when the first read ran in SSR and the cookie never arrived', async () => {
    let cookie: string | null = null
    const fetchCookie = vi.fn(async () => { cookie = 'issued' })
    expect(await csrfTokenFor(cookie, fetchCookie, () => cookie)).toBe('issued')
    expect(fetchCookie).toHaveBeenCalledTimes(1)
  })
  it('sends no token when the cookie still cannot be set, so the server refuses the request', async () => {
    expect(await csrfTokenFor(undefined, async () => {}, () => undefined)).toBeNull()
  })
})

describe('free base presentation', () => {
  it('is a neutral badge that names the free base, never a paying state', () => {
    expect(FREE_BASE_BADGE).toEqual({ tone: 'neutral', labelKey: 'subscription.state.freeBase' })
  })
})

describe('payKindKey', () => {
  it('names the trial checkout as the first subscription payment', () => {
    expect(payKindKey('renewal', 'trialing')).toBe('subscription.pay.kinds.first_payment')
  })
  it('keeps every other label', () => {
    expect(payKindKey('renewal', 'active')).toBe('subscription.pay.kinds.renewal')
    expect(payKindKey('change', 'trialing')).toBe('subscription.pay.kinds.change')
    expect(payKindKey('renewal', null)).toBe('subscription.pay.kinds.renewal')
  })
})

describe('isStaleTrialCheckout', () => {
  it('is stale when the invoice period began on another Riyadh day', () => {
    const opened = '2026-11-14T08:00:00.000Z'
    expect(isStaleTrialCheckout('trialing', opened, new Date('2026-11-14T20:59:00Z'))).toBe(false)
    expect(isStaleTrialCheckout('trialing', opened, new Date('2026-11-14T21:00:00Z'))).toBe(true)
    expect(isStaleTrialCheckout('trialing', opened, new Date('2026-11-13T20:59:00Z'))).toBe(true)
  })
  it('never applies outside a trial or without a period', () => {
    expect(isStaleTrialCheckout('active', '2026-11-01T08:00:00.000Z', new Date('2026-11-14T10:00:00Z'))).toBe(false)
    expect(isStaleTrialCheckout('trialing', null, new Date('2026-11-14T10:00:00Z'))).toBe(false)
  })
})

describe('change-page refusals', () => {
  it('explains an unavailable usage reading and a downgrade below usage', () => {
    expect(refusalKey('usage_unavailable')).toBe('subscription.change.usageUnavailable')
    expect(refusalKey('downgrade_below_usage')).toBe('subscription.change.downgradeBelowUsage')
  })
})
