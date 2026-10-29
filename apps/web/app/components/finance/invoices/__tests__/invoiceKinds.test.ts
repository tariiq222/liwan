import { describe, expect, it } from 'vitest'
import { invoiceRecordPath, reversedMoveType } from '../invoiceKinds'

describe('the document a credit note reverses', () => {
  it('opens a credit note origin as an invoice and a refund origin as a bill', () => {
    expect(invoiceRecordPath(reversedMoveType('out_refund'), 7)).toBe(invoiceRecordPath('out_invoice', 7))
    expect(invoiceRecordPath(reversedMoveType('in_refund'), 7)).toBe(invoiceRecordPath('in_invoice', 7))
    expect(reversedMoveType('out_invoice')).toBe('out_invoice')
  })
})
