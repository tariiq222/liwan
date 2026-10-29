import { describe, expect, it } from 'vitest'
import {
  AppointmentBookingPaymentSchema,
  AppointmentTypePaymentSchema,
  AppointmentTypePaymentUpdateSchema,
} from '../index'

describe('AppointmentTypePaymentSchema', () => {
  it('names the mode, the deposit share and the price of the type', () => {
    const payment = {
      online_payment: 'deposit', deposit_percent: 30, price: 115, currency: 'SAR',
      refund_policy: 'notice', refund_amounts: 'company', refund_tiers: [{ notice_hours: 24, percent: 50 }],
    }
    expect(AppointmentTypePaymentSchema.parse(payment)).toEqual(payment)
    expect(AppointmentTypePaymentSchema.parse({ ...payment, online_payment: 'none', price: null }).price).toBeNull()
    expect(() => AppointmentTypePaymentSchema.parse({ ...payment, deposit_percent: 100 })).toThrow()
    expect(() => AppointmentTypePaymentSchema.parse({ ...payment, product_id: 4 })).toThrow()
    expect(() => AppointmentTypePaymentSchema.parse({ ...payment, refund_policy: 'later' })).toThrow()
    expect(() => AppointmentTypePaymentSchema.parse({ ...payment, refund_tiers: [{ notice_hours: 24, percent: 101 }] })).toThrow()
  })

  it('accepts a partial change and refuses an empty one', () => {
    expect(AppointmentTypePaymentUpdateSchema.parse({ price: 200 })).toEqual({ price: 200 })
    expect(() => AppointmentTypePaymentUpdateSchema.parse({})).toThrow()
    expect(() => AppointmentTypePaymentUpdateSchema.parse({ online_payment: 'later' })).toThrow()
    expect(() => AppointmentTypePaymentUpdateSchema.parse({ price: 0 })).toThrow()
    expect(AppointmentTypePaymentUpdateSchema.parse({ refund_policy: 'none' })).toEqual({ refund_policy: 'none' })
    expect(() => AppointmentTypePaymentUpdateSchema.parse({ refund_tiers: Array(6).fill({ notice_hours: 1, percent: 10 }) })).toThrow()
    expect(() => AppointmentTypePaymentUpdateSchema.parse({ refund_tiers: [{ notice_hours: 24, percent: 50 }, { notice_hours: 24, percent: 10 }] })).toThrow()
  })
})

describe('AppointmentBookingPaymentSchema', () => {
  it('describes an order payment or none', () => {
    const payment = {
      status: 'payable', needs_attention: false, currency: 'SAR', amount_total: 115, amount_due: 115,
      amount_received: 0, amount_to_refund: 0, expires_at: '2026-10-28T12:00:00Z',
    }
    expect(AppointmentBookingPaymentSchema.parse(payment)).toEqual(payment)
    const none = {
      status: 'none', needs_attention: false, currency: null, amount_total: null, amount_due: null,
      amount_received: null, amount_to_refund: null, expires_at: null,
    }
    expect(AppointmentBookingPaymentSchema.parse(none)).toEqual(none)
    expect(() => AppointmentBookingPaymentSchema.parse({ ...payment, status: 'refunded' })).toThrow()
    expect(() => AppointmentBookingPaymentSchema.parse({ ...payment, refund_due: true })).toThrow()
  })
})
