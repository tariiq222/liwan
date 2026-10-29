import { describe, expect, it } from 'vitest'
import { operationKpiLink, operationKpiStates, operationKpiTiles } from '../kpis'

const t = (key: string) => `t:${key}`

describe('operation KPI links', () => {
  it('filter the scope list by the tile state and keep the search', () => {
    expect(operationKpiLink('pending', undefined, undefined, 'employee')).toBe('/operations/pending?purpose=employee')
    expect(operationKpiLink('mine', undefined)).toBe('/operations')
    expect(operationKpiLink('mine', 'returned')).toBe('/operations?state=returned')
    expect(operationKpiLink('monitoring', 'done', 'عقد')).toBe('/operations/monitoring?q=%D8%B9%D9%82%D8%AF&state=done')
  })
  it('give the pending list no state, as it is already one', () => {
    expect(operationKpiLink('pending', undefined, 'x')).toBe('/operations/pending?q=x')
    expect(operationKpiLink('pending', 'pending')).toBe('/operations/pending')
  })
})

describe('operation KPI tiles', () => {
  it('use only states the list API filters on', () => {
    const api = ['draft', 'pending', 'returned', 'rejected', 'withdrawn', 'done']
    for (const states of Object.values(operationKpiStates)) for (const state of Object.values(states)) expect(state === undefined || api.includes(state)).toBe(true)
  })
  it('show the server total per tile and a dash while it has not arrived', () => {
    const tiles = operationKpiTiles('mine', { total: 9, pending: 0, done: 4 }, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.to])).toEqual([
      ['total', 9, '/operations'], ['pending', 0, '/operations?state=pending'], ['returned', null, '/operations?state=returned'], ['done', 4, '/operations?state=done'],
    ])
    expect(tiles[0]?.label).toBe('t:operations.kpi.mine.total')
  })
  it('build one tile for the pending list and four state tiles for monitoring', () => {
    expect(operationKpiTiles('pending', { awaiting: 3 }, t).map(tile => [tile.id, tile.value, tile.to])).toEqual([['awaiting', 3, '/operations/pending']])
    expect(operationKpiTiles('monitoring', {}, t).map(tile => tile.id)).toEqual(['pending', 'returned', 'rejected', 'done'])
  })
})
