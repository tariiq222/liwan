import { describe, expect, it } from 'vitest'
import {
  ASSET_PAGE_SIZE,
  assetActiveFilterCount,
  assetFiltersFromQuery,
  assetSummaryParams,
  assetKpiTiles,
  assetListParams,
} from '../assetListParams'

describe('asset list filters from the URL', () => {
  it('reads the supported filters', () => {
    const filters = assetFiltersFromQuery({ q: ' AST ', state: 'open', profile_id: '2', page: '3' })
    expect(filters).toEqual({ q: 'AST', state: 'open', profileId: 2, page: 3 })
    expect(assetActiveFilterCount(filters)).toBe(3)
  })

  it('drops what the API would refuse', () => {
    expect(assetFiltersFromQuery({ state: 'posted', profile_id: '-2', page: '0' })).toEqual({ q: '', state: null, profileId: null, page: 1 })
    expect(assetFiltersFromQuery({ profile_id: 'x', state: ['draft', 'open'] })).toMatchObject({ profileId: null, state: 'draft' })
  })
})

describe('asset list params', () => {
  it('sends the filters and the page window', () => {
    expect(assetListParams(assetFiltersFromQuery({ state: 'draft', profile_id: '4', q: 'x', page: '2' }))).toEqual({ state: 'draft', profile_id: 4, q: 'x', limit: ASSET_PAGE_SIZE, offset: ASSET_PAGE_SIZE })
  })

  it('omits filters that are not set', () => {
    expect(assetListParams(assetFiltersFromQuery({}))).toEqual({ limit: ASSET_PAGE_SIZE, offset: 0 })
  })
})

describe('KPI params and tiles', () => {
  const filters = assetFiltersFromQuery({ state: 'close', profile_id: '9', page: '4', q: 'abc' })

  it('keeps meaningful filters while excluding selected state and pagination', () => {
    const params = assetSummaryParams(filters)
    expect(params).not.toHaveProperty('state')
    expect(params).not.toHaveProperty('limit')
    expect(params).not.toHaveProperty('offset')
    expect(params).toEqual({ profile_id: 9, q: 'abc' })
  })

  it('draws all, draft, running and closed tiles from the server counts', () => {
    const tiles = assetKpiTiles(filters, { total: 8, draft: 2, open: 4, close: undefined }, key => key)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['total', 8], ['draft', 2], ['open', 4], ['close', null]])
  })

  it('links every tile to the list with its filters, without the page or the selected state', () => {
    const tiles = assetKpiTiles(filters, { total: 8, draft: 2, open: 4, close: 2 }, key => key)
    const base = '/finance/assets?q=abc&profile_id=9'
    expect(tiles[0]).toMatchObject({ to: base })
    expect(tiles.find(tile => tile.id === 'open')).toMatchObject({ to: `${base}&state=open`, clearTo: base })
    for (const tile of tiles) {
      const query = new URL(tile.to ?? '', 'https://liwan.local').searchParams
      expect(query.has('page')).toBe(false)
      expect(query.getAll('state')).toEqual(tile.id === 'total' ? [] : [tile.id])
    }
  })
})
