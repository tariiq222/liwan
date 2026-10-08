import { describe, expect, it } from 'vitest'
import { planTenantCustomerBody, planTenantQuoteBody } from '../vendorTenantPlan'

describe('a shared tenant starts from a plan, never from a Track A package', () => {
  it('creates the customer with its first administrator only', () => {
    expect(planTenantCustomerBody({ name: ' Acme ', admin_name: ' Sara ', admin_login: ' sara@acme.test ' })).toEqual({ name: 'Acme', admin_name: 'Sara', admin_login: 'sara@acme.test' })
  })
  it('quotes the plan with its included bundles and no extra branches', () => {
    const cadence = { unit: 'month' as const, count: 1 }
    expect(planTenantQuoteBody('c1', { id: 'p1', included_bundle_revision_ids: ['b1', 'b2'] }, cadence)).toEqual({ customer_id: 'c1', kind: 'new', plan_revision_id: 'p1', bundle_revision_ids: ['b1', 'b2'], cadence, requested_extra_branches: 0 })
  })
})
