import { describe, expect, it } from 'vitest'
import { documentKpiTiles } from '../documentKpis'

const t = (key: string, params?: Record<string, unknown>) => params ? `${key}:${params.days}` : key
const figures = { total: 7, archived: undefined, restricted: 5, expiring: 2, expired: 0 }

describe('documentKpiTiles', () => {
  it('leaves the archived tile out for a viewer who cannot archive', () => {
    expect(documentKpiTiles(figures, t).map(tile => tile.id)).toEqual(['total', 'restricted', 'expiring', 'expired'])
  })

  it('links the archived tile to the archived scope', () => {
    const tiles = documentKpiTiles({ ...figures, archived: 2 }, t)
    expect(tiles.at(-1)).toMatchObject({ id: 'archived', value: 2, to: '/documents?archived=1' })
  })

  it('links the restricted, expiring and expired tiles to their filtered lists', () => {
    const tiles = documentKpiTiles(figures, t)
    expect(tiles.find(tile => tile.id === 'restricted')).toMatchObject({ value: 5, to: '/documents?visibility=restricted' })
    expect(tiles.find(tile => tile.id === 'expiring')).toMatchObject({ label: 'documents.kpi.expiring:30', value: 2, tone: 'warning', to: '/documents?expiring_within=30' })
    expect(tiles.find(tile => tile.id === 'expired')).toMatchObject({ value: 0, tone: 'neutral', to: '/documents?expired=1' })
  })
})
