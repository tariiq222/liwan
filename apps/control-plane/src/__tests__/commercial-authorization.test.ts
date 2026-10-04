import { describe, expect, it } from 'vitest'
import { parseCustomerPrincipal, requireCapability, assertNoCustomerIdentity } from '../commercial/authorization.js'
const tenant = '00000000-0000-4000-8000-000000000001'
const encode = (p: unknown) => Buffer.from(JSON.stringify(p)).toString('base64')
describe('commercial authorization', () => {
  it('parses only the customer protocol and resolves customer identity server-side', () => {
    expect(parseCustomerPrincipal(encode({ actor_id: '7', kind: 'customer', tenant_id: tenant, capabilities: ['subscription.read'] }), 'customer')).toMatchObject({ customer_id: 'customer', actor_id: '7' })
  })
  it('rejects vendor capabilities in a customer principal', () => {
    expect(() => parseCustomerPrincipal(encode({ actor_id: '7', kind: 'customer', tenant_id: tenant, capabilities: ['vendor.read'] }), 'customer')).toThrow('unauthorized')
  })
  it('requires every capability, not merely a vendor role', () => {
    expect(() => requireCapability({ capabilities: ['vendor.pricing.manage'] }, 'vendor.pricing.manage', 'vendor.subscriptions.manage')).toThrow('forbidden')
  })
  it('rejects forged nested identities in bodies and query', () => {
    expect(() => assertNoCustomerIdentity({ nested: [{ tenant_id: tenant }] })).toThrow('forbidden_field')
    expect(() => assertNoCustomerIdentity({ customer_id: 'other' })).toThrow('forbidden_field')
  })
})
