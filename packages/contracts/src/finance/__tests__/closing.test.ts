import { describe, expect, it } from 'vitest'
import {
  FinanceClosingErrorCodeSchema,
  FinanceClosingPreviewSchema,
  FinanceFiscalYearListSchema,
  FinanceFiscalYearSchema,
} from '..'

const YEAR = {
  year: 2025,
  date_from: '2025-01-01',
  date_to: '2025-12-31',
  state: 'closed',
  result: 4000,
  closing_entry: { id: 7, name: 'MISC/2025/12/0001' },
}
const PREVIEW = {
  year: 2025,
  date_from: '2025-01-01',
  date_to: '2025-12-31',
  journal: { id: 3, name: 'Miscellaneous Operations' },
  retained_earnings_account: { id: 9, code: '999999', name: 'Undistributed Profits/Losses' },
  lines: [
    { account: { id: 1, code: '400000', name: 'Revenue' }, debit: 10000, credit: 0 },
    { account: { id: 2, code: '500000', name: 'Expenses' }, debit: 0, credit: 6000 },
    { account: { id: 9, code: '999999', name: 'Undistributed Profits/Losses' }, debit: 0, credit: 4000 },
  ],
  total_debit: 10000,
  total_credit: 10000,
  result: 4000,
  blockers: [{ code: 'has_drafts', message: 'post or delete', details: { drafts: 1 } }],
}

describe('finance closing contracts', () => {
  it('accepts a fiscal year, with or without a closing entry, in the list envelope', () => {
    expect(FinanceFiscalYearSchema.parse(YEAR)).toEqual(YEAR)
    const open = { ...YEAR, state: 'open', closing_entry: null }
    expect(FinanceFiscalYearListSchema.parse({ items: [open, YEAR], total: 2 }).total).toBe(2)
  })

  it('refuses an unknown state and a stray key', () => {
    expect(() => FinanceFiscalYearSchema.parse({ ...YEAR, state: 'frozen' })).toThrow()
    expect(() => FinanceFiscalYearSchema.parse({ ...YEAR, extra: 1 })).toThrow()
  })

  it('accepts the closing preview and refuses a negative amount', () => {
    expect(FinanceClosingPreviewSchema.parse(PREVIEW)).toEqual(PREVIEW)
    const negative = { ...PREVIEW, lines: [{ ...PREVIEW.lines[0], debit: -1 }] }
    expect(() => FinanceClosingPreviewSchema.parse(negative)).toThrow()
  })

  it('accepts the locked state and refuses an unknown blocker', () => {
    expect(FinanceFiscalYearSchema.parse({ ...YEAR, state: 'locked', closing_entry: null }).state).toBe('locked')
    expect(() => FinanceClosingPreviewSchema.parse({ ...PREVIEW, blockers: [{ code: 'x', message: 'm', details: {} }] })).toThrow()
  })

  it('lists the closing refusals', () => {
    expect(FinanceClosingErrorCodeSchema.parse('already_closed')).toBe('already_closed')
    expect(FinanceClosingErrorCodeSchema.parse('year_not_ended')).toBe('year_not_ended')
    expect(() => FinanceClosingErrorCodeSchema.parse('reopen_denied')).toThrow()
  })
})
