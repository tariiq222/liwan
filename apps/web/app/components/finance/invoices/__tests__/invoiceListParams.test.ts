import { describe, expect, it } from 'vitest'
import {
  INVOICE_PAGE_SIZE,
  invoiceActiveFilterCount,
  invoiceFiltersFromQuery,
  invoiceSummaryParams,
  invoiceKpiTiles,
  invoiceListParams,
} from '../invoiceListParams'

describe('invoice list filters from the URL', () => {
  it('reads the supported filters', () => {
    const filters = invoiceFiltersFromQuery({ q: ' INV ', state: 'posted', partner_id: '7', date_from: '2026-01-01', date_to: '2026-01-31', page: '3' })
    expect(filters).toEqual({ q: 'INV', state: 'posted', partnerId: 7, dateFrom: '2026-01-01', dateTo: '2026-01-31', page: 3 })
    expect(invoiceActiveFilterCount(filters)).toBe(5)
  })

  it('drops what the API would refuse', () => {
    const filters = invoiceFiltersFromQuery({ state: 'paid', partner_id: '-2', date_from: '2026-02-01', date_to: '2026-01-01', page: '0' })
    expect(filters).toEqual({ q: '', state: null, partnerId: null, dateFrom: '2026-02-01', dateTo: null, page: 1 })
    expect(invoiceFiltersFromQuery({ date_from: 'yesterday', partner_id: 'x', state: ['draft', 'posted'] })).toMatchObject({ dateFrom: null, partnerId: null, state: 'draft' })
  })
})

describe('invoice list params', () => {
  it('sends the type, the filters and the page window', () => {
    const filters = invoiceFiltersFromQuery({ state: 'draft', partner_id: '4', q: 'x', page: '2' })
    expect(invoiceListParams('in_invoice', filters)).toEqual({ move_type: 'in_invoice', state: 'draft', partner_id: 4, q: 'x', limit: INVOICE_PAGE_SIZE, offset: INVOICE_PAGE_SIZE })
  })

  it('omits filters that are not set', () => {
    expect(invoiceListParams('out_invoice', invoiceFiltersFromQuery({}))).toEqual({ move_type: 'out_invoice', limit: INVOICE_PAGE_SIZE, offset: 0 })
  })
})

describe('KPI params and tiles', () => {
  const filters = invoiceFiltersFromQuery({ state: 'posted', partner_id: '9', date_from: '2026-03-01', page: '4', q: 'abc' })

  it('keeps meaningful filters while excluding selected state and pagination', () => {
    const params = invoiceSummaryParams('out_refund', filters)
    expect(params).not.toHaveProperty('state')
    expect(params).not.toHaveProperty('limit')
    expect(params).not.toHaveProperty('offset')
    expect(params).toEqual({ move_type: 'out_refund', partner_id: 9, date_from: '2026-03-01', q: 'abc' })
  })

  it('builds one tile per state from the server totals, empty while a count is missing', () => {
    const tiles = invoiceKpiTiles({ total: 12, draft: 3, posted: 8, cancel: undefined }, id => id)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['total', 12], ['draft', 3], ['posted', 8], ['cancel', null]])
    expect(tiles.find(tile => tile.id === 'draft')?.tone).toBe('warning')
  })
})
