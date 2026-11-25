import { describe, expect, it } from 'vitest'
import { BANK_PAGE_SIZE, bankActiveFilterCount, bankFiltersFromQuery, bankListParams } from '../bankListParams'

describe('bank list filters from the URL', () => {
  it('reads the supported filters', () => {
    const filters = bankFiltersFromQuery({ journal_id: '3', date_from: '2026-01-01', date_to: '2026-01-31', page: '2' })
    expect(filters).toEqual({ journalId: 3, dateFrom: '2026-01-01', dateTo: '2026-01-31', page: 2 })
    expect(bankActiveFilterCount(filters)).toBe(3)
  })

  it('drops what the API would refuse', () => {
    expect(bankFiltersFromQuery({ journal_id: '-2', date_from: '2026-02-01', date_to: '2026-01-01', page: '0' }))
      .toEqual({ journalId: null, dateFrom: '2026-02-01', dateTo: null, page: 1 })
    expect(bankFiltersFromQuery({ journal_id: 'x', date_from: 'yesterday' })).toMatchObject({ journalId: null, dateFrom: null })
  })
})

describe('bank list params', () => {
  it('sends only the filters that are set, with the page offset', () => {
    expect(bankListParams({ journalId: null, dateFrom: null, dateTo: null, page: 1 })).toEqual({ limit: BANK_PAGE_SIZE, offset: 0 })
    expect(bankListParams({ journalId: 3, dateFrom: '2026-01-01', dateTo: null, page: 3 }))
      .toEqual({ journal_id: 3, date_from: '2026-01-01', limit: BANK_PAGE_SIZE, offset: 2 * BANK_PAGE_SIZE })
  })
})
