import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_PRIVACY_REASON_MAX,
  CustomerEraseIncompleteDetailsSchema,
  CustomerEraseResultSchema,
  CustomerErasePreviewSchema,
  CustomerEraseSchema,
  CustomerPrivacyExportSchema,
} from '../index'

const PREVIEW = {
  customer: { id: 7, erased: false },
  items: [
    { key: 'customer', owner: 'liwan_customers', action: 'erase', count: 2, complete: true },
    { key: 'finance_documents', owner: 'liwan_finance', action: 'retain', count: 3, complete: false },
    { key: 'sale.order', owner: 'sale', action: 'unhandled', count: 1, complete: false },
  ],
  incomplete: [{ key: 'sale.order', owner: 'sale', reason: 'application_has_no_hook' }],
  empty_models: ['hr.job'],
  not_covered: ['chatter_history', 'a_future_key'],
  reach: { shared: true, covers_all: false },
  token: 'abc',
  expires_in: 600,
}

describe('CustomerErasePreviewSchema', () => {
  it('accepts the serializer shape and keeps unknown keys and reasons', () => {
    expect(CustomerErasePreviewSchema.parse(PREVIEW)).toEqual(PREVIEW)
    const open = { ...PREVIEW, incomplete: [{ key: 'x', owner: '', reason: 'a_new_reason' }] }
    expect(CustomerErasePreviewSchema.parse(open).incomplete[0]?.reason).toBe('a_new_reason')
  })

  it('refuses an unknown action, a missing token and extra fields', () => {
    expect(() => CustomerErasePreviewSchema.parse({ ...PREVIEW, items: [{ ...PREVIEW.items[0], action: 'delete' }] })).toThrow()
    expect(() => CustomerErasePreviewSchema.parse({ ...PREVIEW, token: '' })).toThrow()
    expect(() => CustomerErasePreviewSchema.parse({ ...PREVIEW, extra: 1 })).toThrow()
  })
})

describe('erase request and result', () => {
  it('limits the reason like the server', () => {
    const body = { token: 't', confirmation: 'Mother', reason: 'x' }
    expect(CustomerEraseSchema.parse(body)).toEqual(body)
    expect(() => CustomerEraseSchema.parse({ ...body, reason: 'x'.repeat(CUSTOMER_PRIVACY_REASON_MAX + 1) })).toThrow()
    expect(() => CustomerPrivacyExportSchema.parse({ reason: '' })).toThrow()
    expect(CustomerPrivacyExportSchema.parse({ reason: 'subject request' })).toEqual({ reason: 'subject request' })
  })

  it('accepts a no-op on an erased customer', () => {
    const noop = { customer_id: 7, erased: false, request_id: null, items: [] }
    expect(CustomerEraseResultSchema.parse(noop)).toEqual(noop)
    const done = { customer_id: 7, erased: true, request_id: 4, items: [{ key: 'customer', count: 1 }] }
    expect(CustomerEraseResultSchema.parse(done)).toEqual(done)
  })

  it('reads the details of a refused erase', () => {
    const details = { incomplete: [{ key: 'tags', owner: 'liwan_customers', reason: 'caller_cannot_reach_all_records' }] }
    expect(CustomerEraseIncompleteDetailsSchema.parse(details)).toEqual(details)
    expect(() => CustomerEraseIncompleteDetailsSchema.parse({ incomplete: [] })).toThrow()
  })
})
