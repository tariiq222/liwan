import { describe, expect, it } from 'vitest'
import { customerApiQuery, customerListLocation, parseCustomerListQuery, safeCustomersReturnTo } from '../customerListParams'

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

describe('customerListLocation', () => {
  it('keeps only the list keys, so a record or the create panel returns to the same list', () => {
    expect(customerListLocation({ q: 'منى', archived: '1', page: '2', returnTo: '/x', view: 'board' })).toBe('/customers?q=%D9%85%D9%86%D9%89&archived=1&page=2')
    expect(customerListLocation({}, '#top')).toBe('/customers#top')
  })
})

describe('safeCustomersReturnTo', () => {
  it('accepts the customers list with or without a query, and nothing else', () => {
    expect(safeCustomersReturnTo('/customers?q=a', '/customers')).toBe('/customers?q=a')
    expect(safeCustomersReturnTo('/customers', '/x')).toBe('/customers')
    expect(safeCustomersReturnTo('/customers/4', '/customers')).toBe('/customers')
    expect(safeCustomersReturnTo('//evil.example/customers', '/customers')).toBe('/customers')
    expect(safeCustomersReturnTo(undefined, '/customers')).toBe('/customers')
  })
})

describe('customerApiQuery', () => {
  it('sends the same filters to the list and the export, leaving defaults out', () => {
    expect(customerApiQuery({ q: '', archived: false })).toEqual({})
    expect(customerApiQuery({ q: 'منى', archived: true })).toEqual({ q: 'منى', archived: 'true' })
  })
})
