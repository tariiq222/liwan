import { describe, expect, it } from 'vitest'
import { FinanceBankImportPreviewRequestSchema, FinanceBankImportReadSchema, FinanceBankImportSchema } from '@liwan/contracts'
import {
  applySuggestedMapping, closingMatches, emptyImportDraft, expectedClosing, importBody, importFileBody, importMapping, isStatementFile, readFoundLines, suggestedBalances,
} from '../bankImportModel'

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

  describe('OFX and CAMT files', () => {
    const statementFile = (format: 'ofx' | 'camt') => {
      const draft = ready()
      Object.assign(draft, { format, delimiter: ';', hasHeader: false, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',' })
      return draft
    }

    it('sends only the file and its format, never the CSV layout options', () => {
      for (const format of ['ofx', 'camt'] as const) {
        const body = importFileBody(statementFile(format))
        expect(body).toEqual({ journal_id: 4, content: 'a,b\n1,2', format })
        expect(FinanceBankImportPreviewRequestSchema.parse(body)).toEqual(body)
      }
    })

    it('lets the server detect the format of a file it has not read yet and sends it once it has', () => {
      const draft = ready()
      expect(importFileBody(draft)).not.toHaveProperty('format')
      draft.format = 'csv'
      expect(importFileBody(draft)).toMatchObject({ format: 'csv', has_header: true, date_format: 'YYYY-MM-DD' })
    })

    it('builds an import body with no mapping, once the balances are numbers', () => {
      const draft = statementFile('ofx')
      draft.mapping.amount = ''
      const body = importBody(draft)
      expect(FinanceBankImportSchema.parse(body)).toEqual({ journal_id: 4, content: 'a,b\n1,2', format: 'ofx', balance_start: 1000, balance_end_real: 1250.5, skip_duplicates: true })
      expect(importBody({ ...draft, balanceStart: '' })).toBeNull()
    })

    it('tells a statement file from a CSV one, and the lines of a read from its columns', () => {
      expect(isStatementFile('ofx') && isStatementFile('camt')).toBe(true)
      expect(isStatementFile('csv') || isStatementFile('')).toBe(false)
      const columns = { format: 'csv', delimiter: ',', columns: ['a'], sample: [['1']], suggested_mapping: {}, row_count: 1 } as const
      expect(readFoundLines(FinanceBankImportReadSchema.parse(columns))).toBe(false)
    })

    it('shows the balances the file suggests, and nothing where it does not say', () => {
      expect(suggestedBalances({ balance_start: 1000, balance_end_real: 1279.5 })).toEqual({ balanceStart: '1000', balanceEnd: '1279.5' })
      expect(suggestedBalances({ balance_start: null, balance_end_real: 279.5 })).toEqual({ balanceStart: '', balanceEnd: '279.5' })
    })
  })
})
