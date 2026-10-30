import { describe, expect, it } from 'vitest'
import { PaymentSettingsUpdateSchema, type PaymentSettings } from '@liwan/contracts'
import { draftOfSettings, isValidExpiry, refusesExpiry, settingsUpdate } from '../paymentSettings'

const SAVED: PaymentSettings = { unpaid_order_expiry_minutes: 60, invoice_when_paid: true, refund_policy: 'full', refund_amounts: 'due', revision: 3 }

describe('the orders draft', () => {
  it('starts from the saved settings', () => {
    expect(draftOfSettings(SAVED)).toEqual({ unpaid_order_expiry_minutes: 60, invoice_when_paid: true })
  })
})

describe('isValidExpiry', () => {
  it.each([5, 60, 1440])('accepts %i minutes, inside the bounds the contract states', (minutes) => {
    expect(isValidExpiry(minutes)).toBe(true)
  })

  it.each([[4], [1441], [0], [-5], [60.5], [null], [undefined], [Number.NaN]])('refuses %s', (minutes) => {
    expect(isValidExpiry(minutes)).toBe(false)
  })
})

describe('settingsUpdate', () => {
  it('carries the saved revision and only the settings that changed', () => {
    expect(settingsUpdate(SAVED, { unpaid_order_expiry_minutes: 90, invoice_when_paid: true })).toEqual({ revision: 3, unpaid_order_expiry_minutes: 90 })
    expect(settingsUpdate(SAVED, { unpaid_order_expiry_minutes: 60, invoice_when_paid: false })).toEqual({ revision: 3, invoice_when_paid: false })
    expect(settingsUpdate(SAVED, { unpaid_order_expiry_minutes: 15, invoice_when_paid: false })).toEqual({ revision: 3, unpaid_order_expiry_minutes: 15, invoice_when_paid: false })
  })

  it('never sends an empty expiry', () => {
    expect(settingsUpdate(SAVED, { unpaid_order_expiry_minutes: null, invoice_when_paid: false })).toEqual({ revision: 3, invoice_when_paid: false })
  })

  it('builds a body the contract accepts', () => {
    expect(PaymentSettingsUpdateSchema.safeParse(settingsUpdate(SAVED, { unpaid_order_expiry_minutes: 90, invoice_when_paid: false })).success).toBe(true)
  })
})

describe('refusesExpiry', () => {
  it('is the refusal that names the expiry as its field', () => {
    expect(refusesExpiry({ status: 422, code: 'invalid', field: 'unpaid_order_expiry_minutes' })).toBe(true)
  })

  it('is no other failure', () => {
    expect(refusesExpiry({ status: 422, code: 'invalid', field: 'invoice_when_paid' })).toBe(false)
    expect(refusesExpiry({ status: 409, code: 'conflict' })).toBe(false)
    expect(refusesExpiry(new Error('offline'))).toBe(false)
    expect(refusesExpiry(null)).toBe(false)
  })
})
