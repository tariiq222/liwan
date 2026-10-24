import { describe, expect, it } from 'vitest'
import { addCadence, daysBetween, periodBounds, remainingDays, vat, paidExtraBranches, prorateMinor, riyadhDate, CommercialError, planRevisionSchema, quoteRequestSchema } from '../commercial/index.js'
import { M, plan, sar } from './fixtures.js'

describe('commercial calendar and pricing math', () => {
  it('computes paid extra branches (HQ free)', () => {
    expect(paidExtraBranches(3, 1)).toBe(2)
    expect(paidExtraBranches(0, 1)).toBe(0)
    expect(paidExtraBranches(1, 5)).toBe(0)
    expect(() => paidExtraBranches(-1, 1)).toThrow('invalid_quantity')
    expect(() => paidExtraBranches(1.5, 1)).toThrow('invalid_quantity')
    expect(() => paidExtraBranches(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow('invalid_quantity')
  })
  it('prorates half-up with exact rational math', () => {
    expect(prorateMinor({ cycleMinor: 50000, remainingDays: 15, cycleDays: 31 })).toBe(24194)
    expect(prorateMinor({ cycleMinor: 0, remainingDays: 15, cycleDays: 31 })).toBe(0)
    expect(prorateMinor({ cycleMinor: 1, remainingDays: 1, cycleDays: 2 })).toBe(1)
    expect(prorateMinor({ cycleMinor: 100, remainingDays: 31, cycleDays: 31 })).toBe(100)
    expect(() => prorateMinor({ cycleMinor: 50000, remainingDays: 32, cycleDays: 31 })).toThrow('invalid_billing_period')
    expect(() => prorateMinor({ cycleMinor: 50000, remainingDays: -1, cycleDays: 31 })).toThrow('invalid_billing_period')
    expect(() => prorateMinor({ cycleMinor: 50000, remainingDays: 1, cycleDays: 0 })).toThrow('invalid_billing_period')
    expect(() => prorateMinor({ cycleMinor: -5, remainingDays: 1, cycleDays: 31 })).toThrow('invalid_billing_period')
    expect(() => prorateMinor({ cycleMinor: 1.5, remainingDays: 1, cycleDays: 31 })).toThrow('invalid_billing_period')
    expect(() => prorateMinor({ cycleMinor: Number.MAX_SAFE_INTEGER + 2, remainingDays: 1, cycleDays: 31 })).toThrow(CommercialError)
  })
  it('counts the activation day and not the renewal day', () => {
    expect(remainingDays('2027-10-17', '2027-11-01')).toBe(15)
    expect(daysBetween('2027-10-01', '2027-11-01')).toBe(31)
    expect(remainingDays('2027-10-01', '2027-11-01')).toBe(31)
  })
  it('handles leap-year cycles', () => {
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29)
    expect(prorateMinor({ cycleMinor: 29000, remainingDays: remainingDays('2028-02-15', '2028-03-01'), cycleDays: 29 })).toBe(15000)
    expect(daysBetween('2027-03-01', '2028-03-01')).toBe(366)
    expect(daysBetween('2026-03-01', '2027-03-01')).toBe(365)
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366)
  })
  it('clamps month ends while preserving the anchor day', () => {
    const m = { unit: 'month', count: 1 } as const
    expect(addCadence('2028-01-31', m, 1)).toBe('2028-02-29')
    expect(addCadence('2028-01-31', m, 2)).toBe('2028-03-31')
    expect(addCadence('2027-01-31', m, 1)).toBe('2027-02-28')
    expect(periodBounds('2028-01-31', m, '2028-02-29')).toEqual({ start: '2028-02-29', end: '2028-03-31' })
    expect(periodBounds('2028-01-31', m, '2028-02-28')).toEqual({ start: '2028-01-31', end: '2028-02-29' })
    expect(periodBounds('2028-02-29', { unit: 'year', count: 1 }, '2029-03-01')).toEqual({ start: '2029-02-28', end: '2030-02-28' })
    expect(addCadence('2028-02-29', { unit: 'year', count: 1 }, 4)).toBe('2032-02-29')
    expect(() => periodBounds('2028-03-01', m, '2028-02-01')).toThrow('invalid_billing_period')
    expect(() => addCadence('2028-13-40', m, 1)).toThrow('invalid_billing_period')
  })
  it('computes VAT half-up', () => {
    expect(vat(100000, 1500)).toBe(15000)
    expect(vat(3, 1500)).toBe(0)
    expect(vat(10, 1500)).toBe(2)
    expect(vat(0, 1500)).toBe(0)
  })
  it('maps instants to the Asia/Riyadh calendar day', () => {
    expect(riyadhDate('2027-10-16T21:00:00Z')).toBe('2027-10-17')
    expect(riyadhDate('2027-10-16T20:59:59Z')).toBe('2027-10-16')
  })
})

describe('commercial metering contracts', () => {
  it('accepts the metered fields on a plan', () => {
    const metered = plan({ included_users: 3, included_storage_mb: 5120, user_prices: [{ cadence: M, amount: sar(2500) }], storage_prices: [{ cadence: M, amount: sar(500) }] })
    expect(planRevisionSchema.safeParse(metered).success).toBe(true)
  })
  it('rejects a negative included minimum', () => {
    expect(planRevisionSchema.safeParse(plan({ included_users: -1 })).success).toBe(false)
  })
  it('rejects a non-integer unit price', () => {
    const p = plan({ user_prices: [{ cadence: M, amount: { currency: 'SAR', exponent: 2, minor: 12.5 } }] })
    expect(planRevisionSchema.safeParse(p).success).toBe(false)
  })
  it('accepts the requested quantities on a quote request and rejects a negative one', () => {
    const request = { kind: 'new', plan_revision_id: '00000000-0000-4000-8000-000000000004', bundle_revision_ids: [], cadence: M, requested_extra_branches: 0, requested_users: 10, requested_storage_mb: 20480 }
    expect(quoteRequestSchema.safeParse(request).success).toBe(true)
    expect(quoteRequestSchema.safeParse({ ...request, requested_users: -1 }).success).toBe(false)
  })
})
