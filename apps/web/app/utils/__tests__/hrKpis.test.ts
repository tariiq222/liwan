import { describe, expect, it } from 'vitest'
import { departmentKpiTiles, employeeKpiTiles, hrLeaveKpiQueries, hrLeaveKpiTiles } from '../hrKpis'

const t = (key: string) => key
const n = (value: number) => String(value)

describe('employeeKpiTiles', () => {
  it('shows every tile for a manager and links the report tiles', () => {
    const tiles = employeeKpiTiles({ headcount: 42, archived: 3, saudiPercent: 62.5, expiring: 4, expiryDays: 30 }, t, n)
    expect(tiles.map(tile => tile.id)).toEqual(['headcount', 'archived', 'saudization', 'expiring'])
    expect(tiles.map(tile => tile.value)).toEqual([42, 3, '62.5%', 4])
    expect(tiles.find(tile => tile.id === 'saudization')).toMatchObject({ progress: 62.5, to: '/hr/reports' })
    expect(tiles.find(tile => tile.id === 'expiring')).toMatchObject({ tone: 'warning', to: '/hr/reports', hint: 'hr.kpi.expiringHint' })
    expect(tiles.find(tile => tile.id === 'archived')).toMatchObject({ to: '/hr?archived=1', clearTo: '/hr' })
    expect(tiles.find(tile => tile.id === 'headcount')).not.toHaveProperty('to')
  })

  it('omits the tiles behind a capability the viewer lacks', () => {
    const tiles = employeeKpiTiles({ headcount: 42, archived: undefined, saudiPercent: undefined, expiring: undefined, expiryDays: 30 }, t, n)
    expect(tiles.map(tile => tile.id)).toEqual(['headcount'])
  })

  it('shows a dash for a loading figure or an unknown rate, and a quiet tone for nothing expiring', () => {
    const tiles = employeeKpiTiles({ headcount: null, archived: undefined, saudiPercent: null, expiring: 0, expiryDays: 30 }, t, n)
    expect(tiles.map(tile => tile.value)).toEqual([null, null, 0])
    expect(tiles.find(tile => tile.id === 'saudization')).not.toHaveProperty('progress')
    expect(tiles.find(tile => tile.id === 'expiring')?.tone).toBe('neutral')
  })
})

describe('departmentKpiTiles', () => {
  it('counts the departments from the server total and the unmanaged ones from the complete list', () => {
    const tiles = departmentKpiTiles({ total: 5, items: [{ manager: { id: 1 } }, { manager: null }, { manager: null }] }, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.tone])).toEqual([['departments', 5, 'neutral'], ['unmanaged', 2, 'warning']])
  })

  it('shows dashes while the list loads', () => {
    expect(departmentKpiTiles(null, t).map(tile => tile.value)).toEqual([null, null])
  })
})

describe('leave KPI tiles', () => {
  it('counts the pending queue and the approved requests with one row each', () => {
    const queries = hrLeaveKpiQueries()
    expect(queries.pending).toEqual({ scope: 'pending', limit: 1, offset: 0 })
    expect(queries.approved).toEqual({ scope: 'all', state: ['validate'], limit: 1, offset: 0 })
  })

  it('links the pending tile to the list default and clears it to every request', () => {
    const tiles = hrLeaveKpiTiles({ pending: 3, approved: undefined }, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.to, tile.clearTo])).toEqual([
      ['pending', 3, '/hr/leave', '/hr/leave?scope=all'],
      ['approved', null, undefined, undefined],
    ])
    expect(tiles[0]?.tone).toBe('warning')
    expect(hrLeaveKpiTiles({ pending: 0, approved: 4 }, t)[0]?.tone).toBe('neutral')
  })
})
