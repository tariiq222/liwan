import { describe, expect, it } from 'vitest'
import { FinanceBankImportSchema } from '@liwan/contracts'
import { applySuggestedMapping, closingMatches, emptyImportDraft, expectedClosing, importBody, importMapping } from '../bankImportModel'

const ready = () => {
  const draft = emptyImportDraft()
  Object.assign(draft, { journalId: 4, content: 'a,b\n1,2', balanceStart: '1000', balanceEnd: '1250.5' })
  Object.assign(draft.mapping, { date: 'Date', payment_ref: 'Memo', amount: 'Amount' })
  return draft
}

describe('bank import model', () => {
  it('needs a date, a reference and either an amount or a debit with a credit', () => {
    const draft = ready()
    expect(importMapping(draft)).toEqual({ date: 'Date', payment_ref: 'Memo', amount: 'Amount' })
    draft.mapping.amount = ''
    expect(importMapping(draft)).toBeNull()
    draft.mapping.debit = 'Out'
    expect(importMapping(draft)).toBeNull()
    draft.mapping.credit = 'In'
    expect(importMapping(draft)).toEqual({ date: 'Date', payment_ref: 'Memo', debit: 'Out', credit: 'In' })
  })

  it('names columns by position when the file has no header', () => {
    const draft = ready()
    draft.hasHeader = false
    Object.assign(draft.mapping, { date: '0', payment_ref: '2', amount: '3' })
    expect(importMapping(draft)).toEqual({ date: 0, payment_ref: 2, amount: 3 })
  })

  it('keeps what the user mapped and fills only the gaps from the suggestion', () => {
    const draft = emptyImportDraft()
    draft.mapping.date = 'Booking'
    applySuggestedMapping(draft, { date: 'Date', payment_ref: 'Memo' })
    expect(draft.mapping).toMatchObject({ date: 'Booking', payment_ref: 'Memo', amount: '' })
  })

  it('builds a body the contract accepts, only once the balances are numbers', () => {
    const body = importBody(ready())
    expect(FinanceBankImportSchema.parse(body)).toMatchObject({ journal_id: 4, balance_start: 1000, balance_end_real: 1250.5, skip_duplicates: true, decimal_separator: '.' })
    expect(importBody({ ...ready(), balanceEnd: '' })).toBeNull()
    expect(importBody({ ...ready(), journalId: null })).toBeNull()
  })

  it('compares the printed closing balance with opening plus the new lines, to the cent', () => {
    const preview = { summary: { lines: 3, duplicates: 1, total: 250.5, date_from: null, date_to: null } }
    expect(expectedClosing('1000', preview)).toBe(1250.5)
    expect(closingMatches({ balanceStart: '1000', balanceEnd: '1250.50' }, preview)).toBe(true)
    expect(closingMatches({ balanceStart: '1000', balanceEnd: '1250' }, preview)).toBe(false)
    expect(closingMatches({ balanceStart: '', balanceEnd: '1250.5' }, preview)).toBe(false)
  })
})
