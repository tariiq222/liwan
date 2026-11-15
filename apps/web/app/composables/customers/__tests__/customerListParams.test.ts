import { describe, expect, it } from 'vitest'
import { listLocation } from '../../useRouteListFilters'
import { CUSTOMER_LIST_KEYS, CUSTOMERS_LIST_PATH, customerApiQuery, parseCustomerListQuery } from '../customerListParams'

describe('parseCustomerListQuery', () => {
  it('reads the search, the archived switch and the page from the address', () => {
    expect(parseCustomerListQuery({ q: '  منى ', archived: '1', page: '3' })).toEqual({ q: 'منى', archived: true, page: 3 })
  })

  it('falls back to the default list for unknown or repeated values', () => {
    expect(parseCustomerListQuery({})).toEqual({ q: '', archived: false, page: 1 })
    expect(parseCustomerListQuery({ archived: 'yes', page: '-4' })).toEqual({ q: '', archived: false, page: 1 })
    expect(parseCustomerListQuery({ q: ['a', 'b'], page: ['2'] })).toEqual({ q: 'a', archived: false, page: 2 })
  })
})

describe('the way back to the customers list', () => {
  it('keeps the search, the archived switch and the page, so a record or the create panel returns to the same list', () => {
    expect(listLocation(CUSTOMERS_LIST_PATH, CUSTOMER_LIST_KEYS, { q: 'منى', archived: '1', page: '2', returnTo: '/x', view: 'board' })).toBe('/customers?q=%D9%85%D9%86%D9%89&archived=1&page=2')
  })
})

describe('customerApiQuery', () => {
  it('sends the same filters to the list and the export, leaving defaults out', () => {
    expect(customerApiQuery({ q: '', archived: false })).toEqual({})
    expect(customerApiQuery({ q: 'منى', archived: true })).toEqual({ q: 'منى', archived: 'true' })
  })
})
