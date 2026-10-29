import { describe, expect, it } from 'vitest'
import {
  PaymentOrderDetailSchema,
  PaymentOrderListSchema,
  PaymentRefundCreateSchema,
  RefundRulesSchema,
} from '../index'

const ITEM = {
  id: 7,
  number: 'S00007',
  customer: 'Payer customer',
  date: '2026-10-29T08:00:00Z',
  status: 'cancelled',
  needs_attention: false,
  currency: 'SAR',
  amount_total: 115,
  amount_due: 0,
  amount_received: 115,
  amount_to_refund: 57.5,
  expires_at: '2026-10-29T09:00:00Z',
}

describe('PaymentOrderListSchema', () => {
  it('lists the company orders in the list envelope', () => {
    const list = { items: [ITEM], total: 1 }
    expect(PaymentOrderListSchema.parse(list)).toEqual(list)
    expect(() => PaymentOrderListSchema.parse({ items: [{ ...ITEM, refund_due: true }], total: 1 })).toThrow()
    expect(() => PaymentOrderListSchema.parse({ items: [{ ...ITEM, amount_to_refund: -1 }], total: 1 })).toThrow()
  })
})

describe('PaymentOrderDetailSchema', () => {
  it('adds the lines, every payment and refund, and whether partial refunds are allowed', () => {
    const detail = {
      ...ITEM,
      lines: [{ name: 'Consultation', quantity: 1, amount: 115 }],
      transactions: [
        { id: 3, kind: 'payment', state: 'done', amount: 115, provider: 'Paymob', reference: '987654', date: '2026-10-29T08:01:00Z' },
        { id: 4, kind: 'refund', state: 'done', amount: 57.5, provider: 'Paymob', reference: 'PMB-R-1', date: null },
      ],
      partial_refunds: false,
    }
    expect(PaymentOrderDetailSchema.parse(detail)).toEqual(detail)
    expect(() => PaymentOrderDetailSchema.parse({ ...detail, transactions: [{ ...detail.transactions[0], kind: 'capture' }] })).toThrow()
  })
})

describe('PaymentRefundCreateSchema', () => {
  it('takes a positive amount and the gateway refund reference', () => {
    expect(PaymentRefundCreateSchema.parse({ amount: 57.5, reference: ' PMB-R-1 ' })).toEqual({ amount: 57.5, reference: 'PMB-R-1' })
    expect(() => PaymentRefundCreateSchema.parse({ amount: 0, reference: 'R' })).toThrow()
    expect(() => PaymentRefundCreateSchema.parse({ amount: 10, reference: ' ' })).toThrow()
    expect(() => PaymentRefundCreateSchema.parse({ amount: 10, reference: 'x'.repeat(129) })).toThrow()
  })
})

describe('RefundRulesSchema', () => {
  it('names the policy, the refund amounts and at most five unique notice tiers', () => {
    const rules = { refund_policy: 'notice', refund_amounts: 'any', refund_tiers: [{ notice_hours: 48, percent: 100 }, { notice_hours: 24, percent: 50 }] }
    expect(RefundRulesSchema.parse(rules)).toEqual(rules)
    expect(RefundRulesSchema.parse({ refund_policy: 'company', refund_amounts: 'company', refund_tiers: [] }).refund_tiers).toEqual([])
    expect(() => RefundRulesSchema.parse({ ...rules, refund_tiers: [{ notice_hours: 24, percent: 50 }, { notice_hours: 24, percent: 10 }] })).toThrow()
    expect(() => RefundRulesSchema.parse({ ...rules, refund_tiers: Array(6).fill(0).map((_, hours) => ({ notice_hours: hours, percent: 10 })) })).toThrow()
  })
})
