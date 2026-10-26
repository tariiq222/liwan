import { describe, expect, it } from 'vitest'
import { planTenantCustomerBody, planTenantQuoteBody } from '../vendorTenantPlan'

describe('a shared tenant starts from a plan, never from a Track A package', () => {
  it('creates the customer with its first administrator and a retry-stable request id', () => {
    expect(planTenantCustomerBody({ name: ' Acme ', admin_name: ' Sara ', admin_login: ' sara@acme.test ' }, 'r1')).toEqual({ name: 'Acme', admin_name: 'Sara', admin_login: 'sara@acme.test', request_id: 'r1' })
  })
  it('quotes the plan with its included bundles and no extra branches', () => {
    const cadence = { unit: 'month' as const, count: 1 }
    expect(planTenantQuoteBody('c1', { id: 'p1', included_bundle_revision_ids: ['b1', 'b2'], included_users: 3, included_storage_mb: 5120 }, cadence)).toEqual({ customer_id: 'c1', kind: 'new', plan_revision_id: 'p1', bundle_revision_ids: ['b1', 'b2'], cadence, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120 })
  })
})
