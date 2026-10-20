import { describe, expect, it } from 'vitest'
import { ACCOUNT_PAGE_SIZE, ACCOUNT_TYPES, accountActiveFilterCount, accountFiltersFromQuery, accountListParams } from '../accountListParams'

describe('account list filters from the URL', () => {
  it('reads the search, the type and the page', () => {
    const filters = accountFiltersFromQuery({ q: ' 1100 ', account_type: 'asset_cash', page: '2' })
    expect(filters).toEqual({ q: '1100', accountType: 'asset_cash', page: 2 })
    expect(accountActiveFilterCount(filters)).toBe(2)
  })

  it('drops a type the API does not know', () => {
    expect(accountFiltersFromQuery({ account_type: 'bogus', page: '-1' })).toEqual({ q: '', accountType: null, page: 1 })
  })

  it('offers every account type of the contract', () => {
    expect(ACCOUNT_TYPES).toContain('expense_direct_cost')
    expect(ACCOUNT_TYPES).toHaveLength(19)
  })
})

describe('account list params', () => {
  it('sends the filters and the page window', () => {
    expect(accountListParams(accountFiltersFromQuery({ q: 'x', account_type: 'income', page: '3' }))).toEqual({ account_type: 'income', q: 'x', limit: ACCOUNT_PAGE_SIZE, offset: 2 * ACCOUNT_PAGE_SIZE })
    expect(accountListParams(accountFiltersFromQuery({}))).toEqual({ limit: ACCOUNT_PAGE_SIZE, offset: 0 })
  })
})
