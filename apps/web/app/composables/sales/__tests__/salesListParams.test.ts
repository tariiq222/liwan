import { describe, expect, it } from 'vitest'
import { SALES_PAGE_SIZE, parseSalesListQuery, safeSalesReturnTo, salesApiQuery, salesListLocation } from '../salesListParams'

describe('sales list address', () => {
  it('reads the filters and the page from the query, with defaults for anything unknown', () => {
    expect(parseSalesListQuery({ q: ' S0001 ', state: 'orders', source: 'online', mine: '1', page: '2' })).toEqual({ q: 'S0001', stage: 'orders', source: 'online', mine: true, page: 2 })
    expect(parseSalesListQuery({ state: 'confirmed', source: 'shop', mine: 'yes', page: 'x' })).toEqual({ q: '', stage: 'all', source: null, mine: false, page: 1 })
  })

  it('keeps only the list keys in the way back, and accepts only a sales list as a return address', () => {
    expect(salesListLocation({ q: 'x', state: 'quotations', mine: '1', returnTo: '/evil' }, '#top')).toBe('/sales?q=x&state=quotations&mine=1#top')
    expect(salesListLocation({})).toBe('/sales')
    expect(safeSalesReturnTo('/sales?state=orders', '/sales')).toBe('/sales?state=orders')
    expect(safeSalesReturnTo('/sales/new', '/sales')).toBe('/sales')
    expect(safeSalesReturnTo('/products', '/sales')).toBe('/sales')
  })

  it('asks the API for a page, a stage as its states', () => {
    expect(salesApiQuery({ q: '', stage: 'all', source: null, mine: false, page: 1 })).toEqual({ limit: SALES_PAGE_SIZE, offset: 0 })
    expect(salesApiQuery({ q: 'x', stage: 'quotations', source: 'staff', mine: true, page: 3 })).toEqual({ q: 'x', state: 'draft,sent', source: 'staff', mine: 'true', limit: 25, offset: 50 })
    expect(salesApiQuery({ q: '', stage: 'orders', source: null, mine: false, page: 1 }).state).toBe('confirmed')
  })
})
