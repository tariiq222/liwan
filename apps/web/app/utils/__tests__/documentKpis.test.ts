import { describe, expect, it } from 'vitest'
import { documentKpiTiles } from '../documentKpis'

const t = (key: string) => key

describe('documentKpiTiles', () => {
  it('leaves the archived tile out for a viewer who cannot archive', () => {
    expect(documentKpiTiles({ total: 7, archived: undefined }, t).map(tile => tile.id)).toEqual(['total'])
  })

  it('links the archived tile to the archived scope', () => {
    const tiles = documentKpiTiles({ total: 7, archived: 2 }, t)
    expect(tiles[1]).toMatchObject({ value: 2, to: '/documents?archived=1' })
  })
})
