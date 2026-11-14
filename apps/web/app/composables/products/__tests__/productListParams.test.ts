import { describe, expect, it } from 'vitest'
import { PRODUCT_PAGE_SIZE, parseProductListQuery, productApiQuery, productListLocation, safeProductsReturnTo } from '../productListParams'

describe('product list address', () => {
  it('reads the filters and the page from the query, with defaults for anything unknown', () => {
    expect(parseProductListQuery({ q: ' عسل ', type: 'goods', archived: '1', page: '3' })).toEqual({ q: 'عسل', type: 'goods', archived: true, page: 3 })
    expect(parseProductListQuery({ type: 'combo', archived: 'yes', page: 'x' })).toEqual({ q: '', type: null, archived: false, page: 1 })
    expect(parseProductListQuery({ q: ['a', 'b'] }).q).toBe('a')
  })

  it('keeps only the list keys in the way back, and accepts only a products list as a return address', () => {
    expect(productListLocation({ q: 'x', type: 'service', page: '2', returnTo: '/evil', other: '1' }, '#top')).toBe('/products?q=x&type=service&page=2#top')
    expect(productListLocation({})).toBe('/products')
    expect(safeProductsReturnTo('/products?q=x', '/products')).toBe('/products?q=x')
    expect(safeProductsReturnTo('/products/new', '/products')).toBe('/products')
    expect(safeProductsReturnTo('/customers', '/products')).toBe('/products')
    expect(safeProductsReturnTo(undefined, '/products')).toBe('/products')
  })

  it('asks the API for a page as limit and offset', () => {
    expect(productApiQuery({ q: '', type: null, archived: false, page: 1 })).toEqual({ limit: PRODUCT_PAGE_SIZE, offset: 0 })
    expect(productApiQuery({ q: 'x', type: 'goods', archived: true, page: 3 })).toEqual({ q: 'x', type: 'goods', archived: 'true', limit: PRODUCT_PAGE_SIZE, offset: 2 * PRODUCT_PAGE_SIZE })
  })
})
