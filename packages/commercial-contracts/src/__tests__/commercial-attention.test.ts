import { describe, expect, it } from 'vitest'
import { ATTENTION_LIMIT, attentionItemSchema, attentionSchema } from '../commercial/index.js'

const id = '00000000-0000-4000-8000-000000000001'
const item = { kind: 'past_due', customer_id: id, tenant_id: null, operation_id: null, invoice_id: id, name: 'شركة س', since: '2026-10-04T00:00:00Z', detail: null }
const counts = { subscriptions_active: 1, subscriptions_pending: 0, past_due: 1, stalled: 0, setup_required: 0, renewals: 0 }

describe('vendor attention contract', () => {
  it('accepts a typed item and a list with its counts', () => {
    expect(attentionItemSchema.parse(item).kind).toBe('past_due')
    expect(attentionSchema.parse({ items: [item], total: 1, counts }).total).toBe(1)
  })
  it('has no overdue-invoice count for callers without billing access', () => {
    expect(attentionSchema.parse({ items: [], total: 0, counts: { ...counts, past_due: null } }).counts.past_due).toBeNull()
  })
  it('rejects unknown kinds, extra fields, bad ids and an over-long list', () => {
    expect(() => attentionItemSchema.parse({ ...item, kind: 'revenue' })).toThrow()
    expect(() => attentionItemSchema.parse({ ...item, amount: 1 })).toThrow()
    expect(() => attentionItemSchema.parse({ ...item, invoice_id: 'x' })).toThrow()
    expect(() => attentionSchema.parse({ items: Array(ATTENTION_LIMIT + 1).fill(item), total: 99, counts })).toThrow()
  })
})
