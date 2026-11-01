import { describe, expect, it } from 'vitest'
import { FinancePaymentTransferSchema, type FinanceJournal } from '@liwan/contracts'
import { exchangeOutcome, transferPaymentLink } from '../paymentModel'
import {
  buildTransfer,
  transferErrorKey,
  transferJournals,
  validateTransferDraft,
  type TransferDraft,
} from '../transferModel'

const draft = (overrides: Partial<TransferDraft> = {}): TransferDraft => ({ fromJournalId: 1, toJournalId: 2, amount: '250.50', paymentDate: '2026-11-01', memo: '', ...overrides })
const journal = (id: number, type: FinanceJournal['type']): FinanceJournal => ({ id, name: `J${id}`, code: `J${id}`, type, currency: 'SAR', default_account: null, active: true })

describe('the transfer draft', () => {
  it('is valid with two different journals, an amount and a date', () => {
    expect(validateTransferDraft(draft())).toEqual({})
  })

  it.each([
    [{ fromJournalId: null }, { fromJournalId: 'required' }],
    [{ toJournalId: null }, { toJournalId: 'required' }],
    [{ toJournalId: 1 }, { toJournalId: 'same' }],
    [{ amount: '' }, { amount: 'required' }],
    [{ amount: '0' }, { amount: 'required' }],
    [{ amount: '-5' }, { amount: 'required' }],
    [{ amount: 'abc' }, { amount: 'required' }],
    [{ paymentDate: null }, { paymentDate: 'required' }],
  ])('refuses %o', (overrides, expected) => {
    expect(validateTransferDraft(draft(overrides as Partial<TransferDraft>))).toEqual(expected)
  })

  it('builds the body the API takes, with the memo only when typed', () => {
    const body = buildTransfer(draft({ memo: '  Cash to bank ' }))
    expect(body).toEqual({ from_journal_id: 1, to_journal_id: 2, amount: 250.5, payment_date: '2026-11-01', memo: 'Cash to bank' })
    expect(FinancePaymentTransferSchema.parse(body)).toEqual(body)
    expect(buildTransfer(draft())).not.toHaveProperty('memo')
  })
})

describe('the journals a transfer may use', () => {
  it('keeps bank and cash journals only', () => {
    expect(transferJournals([journal(1, 'bank'), journal(2, 'cash'), journal(3, 'credit'), journal(4, 'sale'), journal(5, 'general')]).map(item => item.id)).toEqual([1, 2])
  })
})

describe('the refusals of a transfer', () => {
  it('explains the missing transfer account and the currency mismatch in the transfer wording, and a locked period in the shared one', () => {
    expect(transferErrorKey('transfer_account_missing')).toBe('financeDocuments.payments.transfer.errors.transferAccountMissing')
    expect(transferErrorKey('journal_currency_mismatch')).toBe('financeDocuments.payments.transfer.errors.journalCurrencyMismatch')
    expect(transferErrorKey('period_locked')).toBe('financeDocuments.errors.periodLocked')
    expect(transferErrorKey('something_else')).toBeNull()
  })
})

describe('the payments page helpers of this change', () => {
  it('links to the transfer panel with its origin', () => {
    expect(transferPaymentLink('/finance/payments?state=paid')).toEqual({ path: '/finance/payments/transfer/new', query: { returnTo: '/finance/payments?state=paid' } })
    expect(transferPaymentLink()).toEqual({ path: '/finance/payments/transfer/new', query: {} })
  })

  it('names an exchange gain or loss and says nothing for none', () => {
    expect(exchangeOutcome({ exchange_difference: 0 })).toBeNull()
    expect(exchangeOutcome({ exchange_difference: 12.5 })).toEqual({ kind: 'gain', amount: 12.5 })
    expect(exchangeOutcome({ exchange_difference: -3 })).toEqual({ kind: 'loss', amount: 3 })
  })
})
