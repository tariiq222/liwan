import type { FinancePayment, FinancePaymentPatch } from '@liwan/contracts'
import { validatePaymentDraft, type PaymentDraft, type PaymentErrors } from './paymentModel'

export const paymentEditDraft = (payment: Pick<FinancePayment, 'amount' | 'date' | 'journal' | 'memo'>): PaymentDraft =>
  ({ amount: String(payment.amount), paymentDate: payment.date, journalId: payment.journal.id, memo: payment.memo })

/** A draft payment has no document to cap the amount against, so only the basics are checked. */
export const validatePaymentEdit = (draft: PaymentDraft): PaymentErrors => validatePaymentDraft(draft, Number.POSITIVE_INFINITY)

/** Only what changed is sent; null when nothing did. */
export function paymentPatch(payment: Pick<FinancePayment, 'amount' | 'date' | 'journal' | 'memo'>, draft: PaymentDraft): FinancePaymentPatch | null {
  const patch: FinancePaymentPatch = {
    ...(Number(draft.amount) !== payment.amount ? { amount: Number(draft.amount) } : {}),
    ...(draft.paymentDate !== payment.date ? { payment_date: draft.paymentDate! } : {}),
    ...(draft.journalId !== payment.journal.id ? { journal_id: draft.journalId! } : {}),
    ...(draft.memo.trim() !== payment.memo ? { memo: draft.memo.trim() } : {}),
  }
  return Object.keys(patch).length ? patch : null
}
