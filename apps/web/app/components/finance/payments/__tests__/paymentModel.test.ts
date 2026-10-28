import { describe, expect, it } from 'vitest'
import { FinancePaymentRegisterSchema } from '@webvue/contracts'
import {
  MAX_PREFILLED_INVOICES,
  PAYMENT_PAGE_SIZE,
  buildPaymentRegister,
  buildStandalonePayment,
  validateStandaloneDraft,
  paymentActiveFilterCount,
  paymentBatchProblem,
  paymentDirection,
  paymentDue,
  paymentFiltersFromQuery,
  paymentListParams,
  prefilledInvoiceIds,
  registerPaymentLink,
  validatePaymentDraft,
  type PayableInvoice,
} from '../paymentModel'

const invoice = (overrides: Partial<PayableInvoice> = {}): PayableInvoice => ({ id: 1, name: 'INV/1', move_type: 'out_invoice', state: 'posted', partner: { id: 3, name: 'Acme' }, currency: 'SAR', amount_residual: 100, ...overrides })

describe('payment list filters', () => {
  it('reads and rebuilds the supported filters', () => {
    const filters = paymentFiltersFromQuery({ payment_type: 'outbound', state: 'paid', partner_id: '3', date_from: '2026-01-01', page: '2', q: 'x' })
    expect(paymentActiveFilterCount(filters)).toBe(5)
    expect(paymentListParams(filters)).toEqual({ payment_type: 'outbound', state: 'paid', partner_id: 3, date_from: '2026-01-01', q: 'x', limit: PAYMENT_PAGE_SIZE, offset: PAYMENT_PAGE_SIZE })
  })

  it('ignores values the API would refuse', () => {
    expect(paymentListParams(paymentFiltersFromQuery({ payment_type: 'sideways', state: 'lost', page: '-1' }))).toEqual({ limit: PAYMENT_PAGE_SIZE, offset: 0 })
  })
})

describe('register-payment link', () => {
  it('parses positive ids once, in order, up to a cap', () => {
    expect(prefilledInvoiceIds('3, 5,3,x,-1,0')).toEqual([3, 5])
    expect(prefilledInvoiceIds(undefined)).toEqual([])
    expect(prefilledInvoiceIds(Array.from({ length: 40 }, (_, index) => index + 1).join(','))).toHaveLength(MAX_PREFILLED_INVOICES)
  })

  it('builds the link with its origin', () => {
    expect(registerPaymentLink([3, 5], '/finance/sales/invoices/3')).toEqual({ path: '/finance/payments/new', query: { invoice_ids: '3,5', returnTo: '/finance/sales/invoices/3' } })
  })
})

describe('payable documents', () => {
  it('accepts a batch of one partner, currency and type', () => {
    const batch = [invoice(), invoice({ id: 2, amount_residual: 50.25 })]
    expect(paymentBatchProblem(batch)).toBeNull()
    expect(paymentDue(batch)).toBe(150.25)
    expect(paymentDirection(batch)).toBe('inbound')
  })

  it('names why a batch cannot be paid together', () => {
    expect(paymentBatchProblem([invoice({ state: 'draft' })])).toBe('not_posted')
    expect(paymentBatchProblem([invoice({ amount_residual: 0 })])).toBe('nothing_due')
    expect(paymentBatchProblem([invoice(), invoice({ id: 2, partner: { id: 4, name: 'B' } })])).toBe('partner')
    expect(paymentBatchProblem([invoice(), invoice({ id: 2, currency: 'USD' })])).toBe('currency')
    expect(paymentBatchProblem([invoice(), invoice({ id: 2, move_type: 'out_refund' })])).toBe('type')
  })

  it('the direction follows the document type', () => {
    expect(paymentDirection([invoice({ move_type: 'in_invoice' })])).toBe('outbound')
    expect(paymentDirection([invoice({ move_type: 'in_refund' })])).toBe('inbound')
    expect(paymentDirection([invoice(), invoice({ id: 2, move_type: 'in_invoice' })])).toBeNull()
  })
})

describe('payment form', () => {
  const draft = { amount: '100', paymentDate: '2026-05-01', journalId: 8, memo: ' cheque 12 ' }

  it('validates the amount against what is due', () => {
    expect(validatePaymentDraft(draft, 100)).toEqual({})
    expect(validatePaymentDraft({ ...draft, amount: '100.01' }, 100)).toEqual({ amount: 'exceeds' })
    expect(validatePaymentDraft({ ...draft, amount: '0' }, 100)).toEqual({ amount: 'required' })
    expect(validatePaymentDraft({ ...draft, paymentDate: null, journalId: null }, 100)).toEqual({ paymentDate: 'required', journalId: 'required' })
  })

  it('builds a body the contract accepts', () => {
    const body = buildPaymentRegister([1, 2], draft)
    expect(FinancePaymentRegisterSchema.parse(body)).toEqual({ invoice_ids: [1, 2], amount: 100, payment_date: '2026-05-01', journal_id: 8, memo: 'cheque 12' })
    expect(buildPaymentRegister([1], { ...draft, memo: '  ' })).not.toHaveProperty('memo')
  })

  it('builds a standalone payment, naming the party type only when it differs from the direction', () => {
    const draft = { amount: '120', paymentDate: '2026-05-02', journalId: 8, memo: ' ', paymentType: 'inbound' as const, partnerType: 'customer' as const, partnerId: 5 }
    expect(buildStandalonePayment(draft)).toEqual({ payment_type: 'inbound', partner_id: 5, amount: 120, payment_date: '2026-05-02', journal_id: 8 })
    expect(buildStandalonePayment({ ...draft, paymentType: 'outbound' })).toMatchObject({ partner_type: 'customer' })
    expect(validateStandaloneDraft({ ...draft, partnerId: null, amount: '' })).toEqual({ amount: 'required', partnerId: 'required' })
  })
})
