import type { FinanceJournal, FinancePaymentTransfer } from '@liwan/contracts'
import { financeErrorKey } from '../invoices/invoiceErrors'

/** Money moves between the company's own bank and cash journals only; the server refuses any other type. */
export const TRANSFER_JOURNAL_TYPES: readonly FinanceJournal['type'][] = ['bank', 'cash']

export interface TransferDraft {
  fromJournalId: number | null
  toJournalId: number | null
  amount: string
  paymentDate: string | null
  memo: string
}

export type TransferField = 'fromJournalId' | 'toJournalId' | 'amount' | 'paymentDate'
export type TransferErrors = Partial<Record<TransferField, 'required' | 'same'>>

export function transferJournals(journals: readonly FinanceJournal[]): FinanceJournal[] {
  return journals.filter(journal => TRANSFER_JOURNAL_TYPES.includes(journal.type))
}

export function validateTransferDraft(draft: TransferDraft): TransferErrors {
  const amount = draft.amount.trim() === '' ? Number.NaN : Number(draft.amount)
  return {
    ...(draft.fromJournalId ? {} : { fromJournalId: 'required' as const }),
    ...(!draft.toJournalId ? { toJournalId: 'required' as const } : draft.toJournalId === draft.fromJournalId ? { toJournalId: 'same' as const } : {}),
    ...(Number.isFinite(amount) && amount > 0 ? {} : { amount: 'required' as const }),
    ...(draft.paymentDate ? {} : { paymentDate: 'required' as const }),
  }
}

export function buildTransfer(draft: TransferDraft): FinancePaymentTransfer {
  return {
    from_journal_id: draft.fromJournalId!,
    to_journal_id: draft.toJournalId!,
    amount: Number(draft.amount),
    payment_date: draft.paymentDate!,
    ...(draft.memo.trim() ? { memo: draft.memo.trim() } : {}),
  }
}

const TRANSFER_CODE_KEYS: Record<string, string> = {
  transfer_account_missing: 'financeDocuments.payments.transfer.errors.transferAccountMissing',
  journal_currency_mismatch: 'financeDocuments.payments.transfer.errors.journalCurrencyMismatch',
}

/** The message key for a refused transfer: the transfer's own wording first, then the shared finance errors (a locked period). */
export function transferErrorKey(code: string): string | null {
  return TRANSFER_CODE_KEYS[code] ?? financeErrorKey(code)
}

/** Where the missing transfer account is chosen: the fiscal card of the finance setup. */
export const TRANSFER_ACCOUNT_SETUP_PATH = '/settings/apps/finance#setup-fiscal'
