import { describe, expect, it } from 'vitest'
import type { RefundConflict } from '@liwan/commercial-contracts'
import { recordResolutions, showsStuckRefund } from '../stuckRefund'
import { refundErrorKey } from '../vendorSubscriptions'

const stuck = { since: '2026-11-22T08:00:00.000Z', attempts: 3, next_attempt_at: '2026-11-22T09:00:00.000Z', provider_payment_id: null, conflict: null, actions: ['check', 'release'] as const }
const note = (over: Record<string, unknown> = {}) => ({ kind: 'credit_note' as const, status: 'pending' as const, amount: { currency: 'SAR', exponent: 2, minor: 11500 },
  automatic_refund: { state: 'provider_unverified' as const, reason: null, stuck: { ...stuck, actions: [...stuck.actions] } }, ...over })
const conflict = (over: Partial<RefundConflict> = {}): RefundConflict => ({ adjustment_id: 'a', invoice_id: 'i', invoice_number: 'INV-1', amount: { currency: 'SAR', exponent: 2, minor: 11500 },
  cause: 'provider_refund', status: 'refunded', refunded_by: 'vendor:9', refunded_at: '2026-11-22T07:00:00.000Z', same_invoice: true, ...over })

describe('showsStuckRefund', () => {
  it('shows for a pending credit note in a stuck state, to an account that manages billing', () => {
    expect(showsStuckRefund(note(), true)).toBe(true)
  })
  it.each([
    ['no billing grant', note(), false],
    ['a note that is not stuck', note({ automatic_refund: { state: 'in_progress', reason: null, stuck: null } }), true],
    ['a note with no automatic refund', note({ automatic_refund: null }), true],
    ['a refunded note', note({ status: 'refunded' }), true],
    ['a void note', note({ status: 'void' }), true],
    ['a debit note', note({ kind: 'debit_note' }), true],
  ])('hides for %s', (_name, subject, canBilling) => {
    expect(showsStuckRefund(subject, canBilling)).toBe(false)
  })
})

describe('recordResolutions', () => {
  it('offers recording alone with no conflict, or a conflict on another invoice', () => {
    expect(recordResolutions(note(), null)).toEqual(['record'])
    expect(recordResolutions(note(), conflict({ same_invoice: false }))).toEqual(['record'])
  })
  it('offers closing as already recorded only for a settled note of the same invoice that covers this one', () => {
    expect(recordResolutions(note(), conflict())).toEqual(['record', 'already_recorded'])
    expect(recordResolutions(note(), conflict({ amount: { currency: 'SAR', exponent: 2, minor: 5000 } }))).toEqual(['record'])
    expect(recordResolutions(note(), conflict({ status: 'pending' }))).toEqual(['record'])
  })
})

describe('refundErrorKey for the stuck refund actions', () => {
  it.each(['refund_not_stuck', 'provider_status_unverified', 'provider_refund_unavailable', 'provider_refund_amount_unverified', 'provider_refund_partial', 'refund_attempt_too_recent',
    'refund_attempt_unavailable', 'refund_over_credit', 'refund_not_duplicate', 'refund_note_unavailable', 'refund_in_progress', 'refund_reference_in_use'])('gives %s its own sentence', code => {
    expect(refundErrorKey({ statusCode: 409, data: { code } })).toBe(`vendor.invoices.refund.errors.${code}`)
  })
})
