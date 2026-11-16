import { describe, expect, it } from 'vitest'
import { ApiError } from '../../useApi'
import { isSalesDiscountAboveLimit, salesFieldRef, salesFormField, salesInvoiceErrorKey, salesInvoiceField, salesRefundErrorKey, salesRefundField, salesRefusalKey, salesRefusalParams } from '../salesErrors'

describe('salesFormField', () => {
  it('reads a header field and a line field of a 422', () => {
    expect(salesFormField(new ApiError(422, 'invalid', 'bad', 'customer_id'))).toEqual({ kind: 'order', field: 'customer_id' })
    expect(salesFormField(new ApiError(422, 'invalid', 'bad', 'lines.2.quantity'))).toEqual({ kind: 'line', index: 2, field: 'quantity' })
  })

  it('reads the line of a discount above the limit, and nothing for other refusals', () => {
    const discount = new ApiError(403, 'forbidden', 'no', 'lines.0.discount_percent', { reason: 'discount_above_limit' })
    expect(isSalesDiscountAboveLimit(discount)).toBe(true)
    expect(salesFormField(discount)).toEqual({ kind: 'line', index: 0, field: 'discount_percent' })
    expect(salesFormField(new ApiError(403, 'forbidden', 'no', 'customer_id'))).toBeNull()
    expect(salesFormField(new ApiError(422, 'invalid', 'bad', 'lines.x.quantity'))).toBeNull()
    expect(salesFieldRef('lines.1.unit_price')).toBeNull()
    expect(salesFieldRef(undefined)).toBeNull()
  })
})

describe('salesRefusalKey', () => {
  it('names the refusals the screens explain', () => {
    expect(salesRefusalKey(new ApiError(403, 'forbidden', 'no', undefined, { reason: 'discount_above_limit' }))).toBe('sales.errors.discountAboveLimit')
    expect(salesRefusalKey(new ApiError(403, 'transition_forbidden', 'no'))).toBe('sales.errors.transitionForbidden')
    expect(salesRefusalKey(new ApiError(403, 'feature_not_included', 'no'))).toBe('sales.errors.featureNotIncluded')
    expect(salesRefusalKey(new ApiError(403, 'forbidden', 'no'))).toBe('sales.errors.forbidden')
    expect(salesRefusalKey(new ApiError(404, 'not_found', 'no'))).toBe('sales.errors.notFound')
    expect(salesRefusalKey(new ApiError(409, 'conflict', 'no'))).toBe('sales.errors.conflict')
    expect(salesRefusalKey(new ApiError(409, 'quotation_answered', 'no'))).toBe('sales.errors.quotationAnswered')
    expect(salesRefusalKey(new ApiError(500, 'unavailable', 'down'))).toBeNull()
  })

  it('names the refusals of sending and confirming a quotation', () => {
    expect(salesRefusalKey(new ApiError(422, 'customer_email_missing', 'no email'))).toBe('sales.errors.customerEmailMissing')
    expect(salesRefusalKey(new ApiError(422, 'quotation_expired', 'expired'))).toBe('sales.errors.quotationExpired')
    expect(salesRefusalKey(new ApiError(422, 'invalid', 'needs a product line', 'lines'))).toBe('sales.errors.linesRequired')
    expect(salesRefusalKey(new ApiError(422, 'invalid', 'bad', 'lines.0'))).toBeNull()
    expect(salesRefusalKey(new ApiError(422, 'invalid', 'bad', 'lines.0.quantity'))).toBeNull()
    expect(salesRefusalKey(new ApiError(422, 'invalid', 'bad', 'terms'))).toBeNull()
    expect(salesRefusalKey(new ApiError(503, 'pdf_unavailable', 'no engine'))).toBe('sales.errors.pdfUnavailable')
    expect(salesRefusalKey(new ApiError(503, 'mail_unavailable', 'no mail'))).toBe('sales.errors.mailUnavailable')
    const unusable = (details?: Record<string, unknown>) => new ApiError(422, 'template_unusable', 'no', 'template_id', details)
    expect(salesRefusalKey(unusable({ product: 'Audit' }))).toBe('sales.errors.templateUnusableProduct')
    expect(salesRefusalParams(unusable({ product: ' Audit ' }))).toEqual({ product: 'Audit' })
    expect(salesRefusalKey(unusable())).toBe('sales.errors.templateUnusable')
    expect(salesRefusalKey(unusable({ product: '' }))).toBe('sales.errors.templateUnusable')
  })
})

describe('salesRefundErrorKey', () => {
  it('words a refused refund at its field, or as a payment not recorded yet or a repeat', () => {
    expect(salesRefundField(new ApiError(422, 'invalid', 'bad', 'amount'))).toBe('amount')
    expect(salesRefundField(new ApiError(422, 'invalid', 'bad', 'reference'))).toBe('reference')
    expect(salesRefundField(new ApiError(422, 'invalid', 'bad', 'terms'))).toBeNull()
    expect(salesRefundField(new ApiError(409, 'conflict', 'no', 'amount'))).toBeNull()
    expect(salesRefundErrorKey(new ApiError(422, 'invalid', 'bad', 'amount'))).toBe('sales.refund.errors.amount')
    expect(salesRefundErrorKey(new ApiError(422, 'invalid', 'bad', 'reference'))).toBe('sales.refund.errors.reference')
    expect(salesRefundErrorKey(new ApiError(409, 'conflict', 'no'))).toBe('sales.refund.errors.conflict')
  })

  it('leaves the other refusals to the sales wording: not allowed, not included, not found', () => {
    for (const error of [new ApiError(403, 'forbidden', 'no'), new ApiError(403, 'feature_not_included', 'no'), new ApiError(404, 'not_found', 'no'), new ApiError(500, 'x', 'no')]) expect(salesRefundErrorKey(error)).toBeNull()
    expect(salesRefusalKey(new ApiError(403, 'forbidden', 'no'))).toBe('sales.errors.forbidden')
    expect(salesRefusalKey(new ApiError(403, 'feature_not_included', 'no'))).toBe('sales.errors.featureNotIncluded')
    expect(salesRefusalKey(new ApiError(404, 'not_found', 'no'))).toBe('sales.errors.notFound')
  })
})

describe('salesInvoiceErrorKey', () => {
  it('names the refusals of an invoice in their own words', () => {
    expect(salesInvoiceErrorKey(new ApiError(422, 'order_not_confirmed', 'no'))).toBe('sales.invoicing.errors.notConfirmed')
    expect(salesInvoiceErrorKey(new ApiError(422, 'nothing_to_invoice', 'no'))).toBe('sales.invoicing.errors.nothingToInvoice')
    expect(salesInvoiceErrorKey(new ApiError(422, 'down_payment_refused', 'no', 'method'))).toBe('sales.invoicing.errors.downPaymentRefused')
    expect(salesInvoiceErrorKey(new ApiError(422, 'no_journal', 'no', 'journal_id'))).toBe('sales.invoicing.errors.noJournal')
    expect(salesInvoiceErrorKey(new ApiError(403, 'forbidden', 'no', undefined, { reason: 'online_order' }))).toBe('sales.invoicing.errors.online')
    expect(salesInvoiceErrorKey(new ApiError(403, 'forbidden', 'no', undefined, { reason: 'not_the_salesperson' }))).toBe('sales.invoicing.errors.notSalesperson')
    expect(salesInvoiceErrorKey(new ApiError(403, 'forbidden', 'no'))).toBeNull()
    expect(salesInvoiceErrorKey(new ApiError(403, 'feature_not_included', 'no'))).toBe('sales.invoicing.errors.financeNotIncluded')
  })

  it('names a figure beyond what is left, at its field, and leaves any other refusal to the generic words', () => {
    expect(salesInvoiceField(new ApiError(422, 'invalid', 'bad', 'percent'))).toBe('percent')
    expect(salesInvoiceField(new ApiError(422, 'invalid', 'bad', 'amount'))).toBe('amount')
    expect(salesInvoiceErrorKey(new ApiError(422, 'invalid', 'bad', 'amount', { max_amount: 5 }))).toBe('sales.invoicing.errors.amount')
    expect(salesInvoiceErrorKey(new ApiError(422, 'invalid', 'bad', 'percent'))).toBe('sales.invoicing.errors.percent')
    expect(salesInvoiceField(new ApiError(422, 'invalid', 'bad', 'customer_id'))).toBeNull()
    expect(salesInvoiceErrorKey(new ApiError(500, 'internal', 'no'))).toBeNull()
    expect(salesInvoiceErrorKey(new ApiError(403, 'forbidden', 'no'))).toBeNull()
  })
})
