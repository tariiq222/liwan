import { describe, expect, it } from 'vitest'
import { clientListSchema, clientRowSchema, clientStateFilterSchema } from '../commercial/index.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = { customer_id: id(1), tenant_id: id(2), name: 'شركة', subscription_state: 'active', plan_name: 'الأساسية', pending_plan_name: null, renewal_at: '2026-12-01', setup_required: false, tenant_status: 'active', commercial_mode: 'saas', hosting_model: 'managed' }

describe('client list contract', () => {
  it('parses a customer with a workspace, a customer without one and a workspace without a customer', () => {
    expect(clientListSchema.parse({ items: [row, { ...row, tenant_id: null, subscription_state: null, plan_name: null, renewal_at: null, tenant_status: null, commercial_mode: null, hosting_model: null }, { ...row, customer_id: null, subscription_state: null, plan_name: null, renewal_at: null }], total: 3 }).total).toBe(3)
  })
  it('rejects a row with neither a customer nor a workspace and unknown fields', () => {
    expect(clientRowSchema.safeParse({ ...row, customer_id: null, tenant_id: null }).success).toBe(false)
    expect(clientRowSchema.safeParse({ ...row, extra: 1 }).success).toBe(false)
  })
  it('accepts the customer state filters plus the workspace ones', () => {
    for (const value of ['active', 'setup_required', 'no_workspace', 'no_commercial']) expect(clientStateFilterSchema.safeParse(value).success).toBe(true)
    expect(clientStateFilterSchema.safeParse('all').success).toBe(false)
  })
})
