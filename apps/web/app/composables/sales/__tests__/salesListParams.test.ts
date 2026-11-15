import { describe, expect, it } from 'vitest'
import { listLocation } from '../../useRouteListFilters'
import { SALES_LIST_KEYS, SALES_LIST_PATH, SALES_PAGE_SIZE, parseSalesListQuery, salesApiQuery } from '../salesListParams'

describe('sales list address', () => {
  it('reads the filters and the page from the query, with defaults for anything unknown', () => {
    expect(parseSalesListQuery({ q: ' S0001 ', state: 'orders', source: 'online', mine: '1', page: '2' })).toEqual({ q: 'S0001', stage: 'orders', source: 'online', mine: true, page: 2 })
    expect(parseSalesListQuery({ state: 'confirmed', source: 'shop', mine: 'yes', page: 'x' })).toEqual({ q: '', stage: 'all', source: null, mine: false, page: 1 })
  })

  it('keeps only the list keys in the way back', () => {
    expect(listLocation(SALES_LIST_PATH, SALES_LIST_KEYS, { q: 'x', state: 'quotations', mine: '1', returnTo: '/evil' }, '#top')).toBe('/sales?q=x&state=quotations&mine=1#top')
  })

  it('asks the API for a page, a stage as its states', () => {
    expect(salesApiQuery({ q: '', stage: 'all', source: null, mine: false, page: 1 })).toEqual({ limit: SALES_PAGE_SIZE, offset: 0 })
    expect(salesApiQuery({ q: 'x', stage: 'quotations', source: 'staff', mine: true, page: 3 })).toEqual({ q: 'x', state: 'draft,sent', source: 'staff', mine: 'true', limit: 25, offset: 50 })
    expect(salesApiQuery({ q: '', stage: 'orders', source: null, mine: false, page: 1 }).state).toBe('confirmed')
  })
})
