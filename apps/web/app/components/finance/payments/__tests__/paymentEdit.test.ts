import { describe, expect, it } from 'vitest'
import { FinancePaymentPatchSchema } from '@liwan/contracts'
import { paymentEditDraft, paymentPatch, validatePaymentEdit } from '../paymentEdit'

const payment = { amount: 450, date: '2026-05-01', journal: { id: 8, name: 'Bank' }, memo: 'cheque 12' }

describe('draft payment edit', () => {
  it('sends nothing when nothing changed', () => {
    expect(paymentPatch(payment, paymentEditDraft(payment))).toBeNull()
  })

  it('sends only the changed fields, in a body the contract accepts', () => {
    const body = paymentPatch(payment, { ...paymentEditDraft(payment), amount: '500', memo: ' cheque 13 ' })
    expect(FinancePaymentPatchSchema.parse(body)).toEqual({ amount: 500, memo: 'cheque 13' })
    expect(paymentPatch(payment, { ...paymentEditDraft(payment), journalId: 9, paymentDate: '2026-05-02' })).toEqual({ journal_id: 9, payment_date: '2026-05-02' })
  })

  it('needs an amount above zero, a date and a journal, with no upper limit', () => {
    expect(validatePaymentEdit(paymentEditDraft(payment))).toEqual({})
    expect(validatePaymentEdit({ ...paymentEditDraft(payment), amount: '0', paymentDate: null })).toEqual({ amount: 'required', paymentDate: 'required' })
    expect(validatePaymentEdit({ ...paymentEditDraft(payment), amount: '99999999' })).toEqual({})
  })
})
