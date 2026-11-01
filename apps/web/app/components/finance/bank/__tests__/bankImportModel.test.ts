import { describe, expect, it } from 'vitest'
import { FinanceBankImportPreviewRequestSchema, FinanceBankImportReadSchema, FinanceBankImportSchema } from '@liwan/contracts'
import {
  applySuggestedMapping, closingMatches, emptyImportDraft, expectedClosing, csvOptionsChosen, decodeStatementFile, declaredCharset, detectionBody, importBody, importFileBody, importMapping, isStatementFile, readFoundLines, suggestedBalances,
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

  describe('reading a statement file in its own charset', () => {
    const bytes = (...values: number[]) => new Uint8Array(values).buffer
    const ascii = (text: string) => [...text].map(char => char.charCodeAt(0))

    it('reads UTF-8, with or without a byte order mark', () => {
      expect(decodeStatementFile(new TextEncoder().encode('<OFX>مرحبا</OFX>').buffer)).toEqual({ text: '<OFX>مرحبا</OFX>', lossy: false })
      expect(decodeStatementFile(bytes(0xEF, 0xBB, 0xBF, ...ascii('abc'))).text).toBe('abc')
    })

    it('reads UTF-16 by its byte order mark', () => {
      expect(decodeStatementFile(bytes(0xFF, 0xFE, 0x61, 0x00, 0x23, 0x06)).text).toBe('aأ')
      expect(decodeStatementFile(bytes(0xFE, 0xFF, 0x00, 0x61, 0x06, 0x23)).text).toBe('aأ')
    })

    it('reads the OFX 1 header charset and the XML declaration encoding', () => {
      const v1 = bytes(...ascii('OFXHEADER:100\nCHARSET:1256\n\n<NAME>'), 0xDA, ...ascii('</NAME>'))
      expect(declaredCharset(new Uint8Array(v1))).toBe('windows-1256')
      expect(decodeStatementFile(v1)).toEqual({ text: 'OFXHEADER:100\nCHARSET:1256\n\n<NAME>ع</NAME>', lossy: false })
      const xml = bytes(...ascii('<?xml version="1.0" encoding="ISO-8859-1"?><N>'), 0xE9, ...ascii('</N>'))
      expect(decodeStatementFile(xml).text).toContain('é')
      expect(declaredCharset(new Uint8Array(bytes(...ascii('CHARSET:NONE\n<OFX>'))))).toBe('utf-8')
    })

    it('flags text that has a byte with no character, or a charset it does not know', () => {
      expect(decodeStatementFile(bytes(...ascii('<N>'), 0xDA, ...ascii('</N>'))).lossy).toBe(true)
      expect(decodeStatementFile(bytes(...ascii('<?xml version="1.0" encoding="no-such-charset"?>'))).lossy).toBe(true)
    })
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

    it('detects the format with the journal and the text alone, whatever CSV options are chosen', () => {
      const draft = ready()
      Object.assign(draft, { delimiter: ';', hasHeader: false, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',' })
      expect(detectionBody(draft)).toEqual({ journal_id: 4, content: 'a,b\n1,2' })
      expect(FinanceBankImportPreviewRequestSchema.parse(detectionBody(draft))).toEqual({ journal_id: 4, content: 'a,b\n1,2' })
    })

    it('reads a CSV file again only when options beyond the defaults were chosen, and then sends them with the format', () => {
      const draft = ready()
      expect(csvOptionsChosen(draft)).toBe(false)
      Object.assign(draft, { format: 'csv', delimiter: ';' })
      expect(csvOptionsChosen(draft)).toBe(true)
      expect(csvOptionsChosen({ delimiter: '', hasHeader: false })).toBe(true)
      expect(importFileBody(draft)).toMatchObject({ format: 'csv', delimiter: ';', has_header: true })
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
