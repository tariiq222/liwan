import { describe, expect, it } from 'vitest'
import { operationKpiLink, operationKpiQueryParams, operationKpiStates, operationKpiTiles } from '../kpis'

const t = (key: string) => `t:${key}`

describe('operation KPI links', () => {
  it('filter the scope list by the tile state and keep the search', () => {
    expect(operationKpiLink('mine', undefined)).toBe('/operations')
    expect(operationKpiLink('mine', 'returned')).toBe('/operations?state=returned')
    expect(operationKpiLink('monitoring', 'done', 'عقد')).toBe('/operations/monitoring?q=%D8%B9%D9%82%D8%AF&state=done')
  })
  it('give the pending list no state, as it is already one', () => {
    expect(operationKpiLink('pending', undefined, 'x')).toBe('/operations/pending?q=x')
    expect(operationKpiLink('pending', 'pending')).toBe('/operations/pending')
    expect(operationKpiLink('monitoring', 'done', undefined, 'employee')).toBe('/operations/monitoring?purpose=employee&state=done')
    expect(operationKpiTiles('pending', { awaiting: 1 }, key => key, undefined, 'work')[0]?.to).toBe('/operations/pending?purpose=work')
  })
  it('link personal request tiles to /account/requests with search and state, never purpose', () => {
    expect(operationKpiLink('mine', undefined, undefined, undefined, true)).toBe('/account/requests')
    expect(operationKpiLink('mine', 'pending', undefined, 'employee', true)).toBe('/account/requests?state=pending')
    expect(operationKpiLink('mine', 'returned', 'إجازة', 'work', true)).toBe('/account/requests?q=%D8%A5%D8%AC%D8%A7%D8%B2%D8%A9&state=returned')
  })
})

describe('operation KPI query params', () => {
  it('uses purpose=employee and limit=1 for personal request tiles', () => {
    expect(operationKpiQueryParams('mine', undefined, undefined, undefined, true)).toEqual({ scope: 'mine', purpose: 'employee', q: undefined, state: undefined, limit: 1 })
    expect(operationKpiQueryParams('mine', 'pending', 'بدل', 'work', true)).toEqual({ scope: 'mine', purpose: 'employee', q: 'بدل', state: 'pending', limit: 1 })
    expect(operationKpiQueryParams('monitoring', 'done', undefined, undefined, true)).toEqual({ scope: 'mine', purpose: 'employee', q: undefined, state: 'done', limit: 1 })
  })
  it('keeps work purpose on mine and optional purpose on pending/monitoring', () => {
    expect(operationKpiQueryParams('mine', 'returned', 'عقد', undefined, false)).toEqual({ scope: 'mine', purpose: 'work', q: 'عقد', state: 'returned', limit: 1 })
    expect(operationKpiQueryParams('pending', undefined, undefined, 'employee', false)).toEqual({ scope: 'pending', purpose: 'employee', q: undefined, state: undefined, limit: 1 })
    expect(operationKpiQueryParams('monitoring', 'rejected', undefined, undefined, false)).toEqual({ scope: 'monitoring', q: undefined, state: 'rejected', limit: 1 })
  })
})

describe('operation KPI tiles', () => {
  it('use only states the list API filters on', () => {
    const api = ['draft', 'pending', 'returned', 'rejected', 'withdrawn', 'done']
    for (const states of Object.values(operationKpiStates)) for (const state of Object.values(states)) expect(state === undefined || api.includes(state)).toBe(true)
  })
  it('show the server total per tile and a dash while it has not arrived', () => {
    const tiles = operationKpiTiles('mine', { total: 9, pending: 0, done: 4 }, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.to, tile.clearTo])).toEqual([
      ['total', 9, '/operations', undefined],
      ['pending', 0, '/operations?state=pending', '/operations'],
      ['returned', null, '/operations?state=returned', '/operations'],
      ['done', 4, '/operations?state=done', '/operations'],
    ])
    expect(tiles[0]?.label).toBe('t:operations.kpi.mine.total')
  })
  it('builds personal request tiles with to/clearTo on /account/requests', () => {
    const tiles = operationKpiTiles('mine', { total: 5, pending: 2, returned: 1, done: 2 }, t, 'شهادة', undefined, true)
    expect(tiles.map(tile => [tile.id, tile.value, tile.to, tile.clearTo])).toEqual([
      ['total', 5, '/account/requests?q=%D8%B4%D9%87%D8%A7%D8%AF%D8%A9', undefined],
      ['pending', 2, '/account/requests?q=%D8%B4%D9%87%D8%A7%D8%AF%D8%A9&state=pending', '/account/requests?q=%D8%B4%D9%87%D8%A7%D8%AF%D8%A9'],
      ['returned', 1, '/account/requests?q=%D8%B4%D9%87%D8%A7%D8%AF%D8%A9&state=returned', '/account/requests?q=%D8%B4%D9%87%D8%A7%D8%AF%D8%A9'],
      ['done', 2, '/account/requests?q=%D8%B4%D9%87%D8%A7%D8%AF%D8%A9&state=done', '/account/requests?q=%D8%B4%D9%87%D8%A7%D8%AF%D8%A9'],
    ])
  })
  it('build one tile for the pending list and four state tiles for monitoring', () => {
    expect(operationKpiTiles('pending', { awaiting: 3 }, t).map(tile => [tile.id, tile.value, tile.to, tile.clearTo])).toEqual([
      ['awaiting', 3, '/operations/pending', undefined],
    ])
    const monitoring = operationKpiTiles('monitoring', {}, t, undefined, 'employee')
    expect(monitoring.map(tile => [tile.id, tile.clearTo])).toEqual([
      ['pending', '/operations/monitoring?purpose=employee'],
      ['returned', '/operations/monitoring?purpose=employee'],
      ['rejected', '/operations/monitoring?purpose=employee'],
      ['done', '/operations/monitoring?purpose=employee'],
    ])
  })
})
