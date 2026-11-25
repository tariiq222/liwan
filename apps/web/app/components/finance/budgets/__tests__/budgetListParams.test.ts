import { describe, expect, it } from 'vitest'
import {
  BUDGET_PAGE_SIZE,
  budgetActiveFilterCount,
  budgetFiltersFromQuery,
  budgetSummaryParams,
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

  it('the summary keeps search while excluding selected state and pagination', () => {
    const filters = budgetFiltersFromQuery({ state: 'draft', q: 'x', page: '4' })
    expect(budgetSummaryParams(filters)).toEqual({ q: 'x' })
  })

  it('has one tile per state after the total, empty until the server answers', () => {
    const filters = budgetFiltersFromQuery({ state: 'draft', q: 'x', page: '4' })
    const tiles = budgetKpiTiles(filters, { total: 6, draft: 2, confirmed: 3, cancelled: undefined }, key => key)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['total', 6], ['draft', 2], ['confirmed', 3], ['cancelled', null]])
  })

  it('links every tile to the list with its search, without the page or the selected state', () => {
    const filters = budgetFiltersFromQuery({ state: 'draft', q: 'x', page: '4' })
    const tiles = budgetKpiTiles(filters, { total: 6, draft: 2, confirmed: 3, cancelled: 1 }, key => key)
    expect(tiles[0]).toMatchObject({ to: '/finance/budgets?q=x' })
    expect(tiles.find(tile => tile.id === 'confirmed')).toMatchObject({ to: '/finance/budgets?q=x&state=confirmed', clearTo: '/finance/budgets?q=x' })
    expect(budgetKpiTiles(budgetFiltersFromQuery({}), { total: 0, draft: 0, confirmed: 0, cancelled: 0 }, key => key)[0]?.to).toBe('/finance/budgets')
  })
})
