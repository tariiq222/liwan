import { describe, expect, it } from 'vitest'
import {
  ENTRY_PAGE_SIZE,
  entryActiveFilterCount,
  entryFiltersFromQuery,
  entryKpiParams,
  entryKpiTiles,
  entryListParams,
} from '../entryListParams'

describe('entry list filters from the URL', () => {
  it('reads the supported filters', () => {
    const filters = entryFiltersFromQuery({ q: ' ADJ ', state: 'posted', journal_id: '5', date_from: '2026-01-01', date_to: '2026-01-31', page: '3' })
    expect(filters).toEqual({ q: 'ADJ', state: 'posted', journalId: 5, dateFrom: '2026-01-01', dateTo: '2026-01-31', page: 3 })
    expect(entryActiveFilterCount(filters)).toBe(5)
  })

  it('drops what the API would refuse', () => {
    const filters = entryFiltersFromQuery({ state: 'paid', journal_id: '-2', date_from: '2026-02-01', date_to: '2026-01-01', page: '0' })
    expect(filters).toEqual({ q: '', state: null, journalId: null, dateFrom: '2026-02-01', dateTo: null, page: 1 })
    expect(entryFiltersFromQuery({ date_from: 'yesterday', journal_id: 'x', state: ['draft', 'posted'] })).toMatchObject({ dateFrom: null, journalId: null, state: 'draft' })
  })
})

describe('entry list params', () => {
  it('sends the filters and the page window', () => {
    const filters = entryFiltersFromQuery({ state: 'draft', journal_id: '4', q: 'x', page: '2' })
    expect(entryListParams(filters)).toEqual({ state: 'draft', journal_id: 4, q: 'x', limit: ENTRY_PAGE_SIZE, offset: ENTRY_PAGE_SIZE })
  })

  it('omits filters that are not set', () => {
    expect(entryListParams(entryFiltersFromQuery({}))).toEqual({ limit: ENTRY_PAGE_SIZE, offset: 0 })
  })
})

describe('KPI params and tiles', () => {
  const filters = entryFiltersFromQuery({ state: 'posted', journal_id: '9', date_from: '2026-03-01', page: '4', q: 'abc' })

  it('keeps the list filters, forces the tile state and asks for one row', () => {
    expect(entryKpiParams(filters, 'draft')).toEqual({ state: 'draft', journal_id: 9, date_from: '2026-03-01', q: 'abc', limit: 1, offset: 0 })
  })

  it('the total tile drops the state filter', () => {
    expect(entryKpiParams(filters, null)).not.toHaveProperty('state')
  })

  it('draws one tile per count, empty until the server answers', () => {
    const tiles = entryKpiTiles({ total: 9, draft: 2, posted: 6, cancel: undefined }, id => id)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['total', 9], ['draft', 2], ['posted', 6], ['cancel', null]])
  })
})
