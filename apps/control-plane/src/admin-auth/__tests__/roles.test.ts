import { describe, expect, it } from 'vitest'
import { VENDOR_ROLES } from '@webvue/commercial-contracts'
import { capabilitiesFor } from '../roles.js'
import { normalizeEmail } from '../accounts.js'

describe('roles', () => {
  it('maps every role exactly as the spec table', () => {
    expect(VENDOR_ROLES).toEqual(['owner','customer_success','finance','product','operations','support'])
    expect(capabilitiesFor(['customer_success'])).toEqual(['vendor.read','vendor.subscriptions.manage','vendor.tenants.manage'])
    expect(capabilitiesFor(['finance'])).toEqual(['vendor.billing.manage','vendor.read'])
    expect(capabilitiesFor(['product'])).toEqual(['vendor.catalog.manage','vendor.pricing.manage','vendor.read'])
    expect(capabilitiesFor(['operations'])).toEqual(['vendor.operations.run','vendor.read'])
    expect(capabilitiesFor(['support'])).toEqual(['vendor.audit.read','vendor.read'])
    expect(capabilitiesFor(['owner'])).toHaveLength(9)
    expect(capabilitiesFor(['finance','customer_success'])).toEqual(['vendor.billing.manage','vendor.read','vendor.subscriptions.manage','vendor.tenants.manage'])
    expect(capabilitiesFor([])).toEqual([])
  })
  it('normalizes email', () => {
    expect(normalizeEmail('  Admin@WebVue.SA ')).toBe('admin@webvue.sa')
    expect(() => normalizeEmail('nope')).toThrow()
  })
})
