import { describe, expect, it } from 'vitest'
import {
  BUDGET_PAGE_SIZE,
  budgetActiveFilterCount,
  budgetFiltersFromQuery,
  budgetKpiParams,
  budgetKpiTiles,
  budgetListParams,
} from '../budgetListParams'

describe('budget list filters from the URL', () => {
  it('reads the supported filters', () => {
    const filters = budgetFiltersFromQuery({ q: ' 2026 ', state: 'confirmed', page: '3' })
    expect(filters).toEqual({ q: '2026', state: 'confirmed', page: 3 })
    expect(budgetActiveFilterCount(filters)).toBe(2)
  })

  it('drops what the API would refuse', () => {
    expect(budgetFiltersFromQuery({ state: 'posted', page: '0' })).toEqual({ q: '', state: null, page: 1 })
    expect(budgetFiltersFromQuery({ state: ['draft', 'cancelled'] })).toMatchObject({ state: 'draft' })
  })
})

describe('budget list params', () => {
  it('sends the filters and the page window', () => {
    const filters = budgetFiltersFromQuery({ state: 'draft', q: 'x', page: '2' })
    expect(budgetListParams(filters)).toEqual({ state: 'draft', q: 'x', limit: BUDGET_PAGE_SIZE, offset: BUDGET_PAGE_SIZE })
  })

  it('a KPI count keeps the list filters, swaps the state and asks for one row', () => {
    const filters = budgetFiltersFromQuery({ state: 'draft', q: 'x', page: '4' })
    expect(budgetKpiParams(filters, 'confirmed')).toEqual({ state: 'confirmed', q: 'x', limit: 1, offset: 0 })
    expect(budgetKpiParams(filters, null)).toEqual({ q: 'x', limit: 1, offset: 0 })
  })

  it('has one tile per state after the total, empty until the server answers', () => {
    const tiles = budgetKpiTiles({ total: 6, draft: 2, confirmed: 3, cancelled: undefined }, id => id)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['total', 6], ['draft', 2], ['confirmed', 3], ['cancelled', null]])
  })
})
