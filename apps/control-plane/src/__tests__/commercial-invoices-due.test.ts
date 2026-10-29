import { describe, expect, it } from 'vitest'
import { invoiceDueDays } from '../commercial/invoices.js'

describe('invoice due days setting', () => {
  it('defaults to seven and accepts 0 to 90', () => {
    expect(invoiceDueDays({})).toBe(7)
    expect(invoiceDueDays({ WEBVUE_INVOICE_DUE_DAYS: '' })).toBe(7)
    expect(invoiceDueDays({ WEBVUE_INVOICE_DUE_DAYS: '0' })).toBe(0)
    expect(invoiceDueDays({ WEBVUE_INVOICE_DUE_DAYS: '90' })).toBe(90)
  })
  it('refuses values outside the range or not whole days', () => {
    for (const bad of ['-1', '91', '1.5', 'abc']) expect(() => invoiceDueDays({ WEBVUE_INVOICE_DUE_DAYS: bad })).toThrow()
  })
})
