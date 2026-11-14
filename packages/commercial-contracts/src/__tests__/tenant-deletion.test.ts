import { describe, expect, it } from 'vitest'
import { CUSTOMER_CAPABILITIES, TENANT_DELETION_HOLD_HOURS, TENANT_DELETION_LAST_CALL_HOURS, TENANT_DELETION_WINDOW_DAYS, attentionKinds, subscriptionViewSchema, tenantDeletionCodeSchema, tenantDeletionSchema } from '../index.js'

const base = {
  id: 's1', customer_id: 'c1', tenant_id: null, state: 'active', applied: null, target: null, pending_order: null, order_cancelled: false, revision: 3,
  renewal_at: '2026-12-12', auto_renew: { enabled: false, consent_at: null, payment_method: null }, trial_ends_at: null, grace_ends_at: null,
}

describe('the tenant deletion contract', () => {
  it('is a customer capability of its own and an attention kind', () => {
    expect(CUSTOMER_CAPABILITIES).toContain('tenant.delete')
    expect(attentionKinds).toContain('tenant_deletion_due')
    expect(attentionKinds).toContain('tenant_deletion_stuck')
    expect([TENANT_DELETION_HOLD_HOURS, TENANT_DELETION_LAST_CALL_HOURS]).toEqual([72, 24]) // the final hold and its last call (owner decision 2026-11-14)
    expect(TENANT_DELETION_WINDOW_DAYS).toBe(90) // the decided window (owner decision 2026-11-13), pinned once here
  })
  it('accepts exactly six digits as the code', () => {
    expect(tenantDeletionCodeSchema.safeParse('012345').success).toBe(true)
    for (const bad of ['12345', '1234567', 'abcdef', '12 345', ' 12345']) expect(tenantDeletionCodeSchema.safeParse(bad).success).toBe(false)
  })
  it('rides the subscription view without hiding a withdrawn request as open', () => {
    const deletion = { state: 'confirmed', requested_at: '2026-11-13T09:00:00.000Z', code_expires_at: null, confirmed_at: '2026-11-13T09:05:00.000Z', due_at: '2026-12-13T09:05:00.000Z', hold_until: null, can_withdraw: true }
    expect(subscriptionViewSchema.parse({ ...base, deletion }).deletion).toEqual(deletion)
    expect(subscriptionViewSchema.parse({ ...base, deletion: null }).deletion).toBeNull()
    expect(tenantDeletionSchema.safeParse({ ...deletion, state: 'withdrawn' }).success).toBe(false)
    expect(tenantDeletionSchema.safeParse({ ...deletion, state: 'deleted' }).success).toBe(false)
    expect(tenantDeletionSchema.safeParse({ ...deletion, state: 'deleting', can_withdraw: false }).success).toBe(true)
    expect(tenantDeletionSchema.safeParse({ ...deletion, reason: 'x' }).success).toBe(false)
  })
})
