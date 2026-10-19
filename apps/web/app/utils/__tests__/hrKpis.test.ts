import { describe, expect, it } from 'vitest'
import { departmentKpiTiles, employeeKpiTiles } from '../hrKpis'

const t = (key: string) => key
const n = (value: number) => String(value)

describe('employeeKpiTiles', () => {
  it('shows every tile for a manager and links the report tiles', () => {
    const tiles = employeeKpiTiles({ headcount: 42, archived: 3, saudiPercent: 62.5, expiring: 4, expiryDays: 30 }, t, n)
    expect(tiles.map(tile => tile.id)).toEqual(['headcount', 'archived', 'saudization', 'expiring'])
    expect(tiles.map(tile => tile.value)).toEqual([42, 3, '62.5%', 4])
    expect(tiles.find(tile => tile.id === 'saudization')).toMatchObject({ progress: 62.5, to: '/hr/reports' })
    expect(tiles.find(tile => tile.id === 'expiring')).toMatchObject({ tone: 'warning', to: '/hr/reports', hint: 'hr.kpi.expiringHint' })
    expect(tiles.find(tile => tile.id === 'archived')?.to).toBe('/hr?archived=1')
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
  it('counts departments without a manager from the complete list', () => {
    const tiles = departmentKpiTiles([{ manager: { id: 1 } }, { manager: null }, { manager: null }], t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.tone])).toEqual([['departments', 3, 'neutral'], ['unmanaged', 2, 'warning']])
  })

  it('shows dashes while the list loads', () => {
    expect(departmentKpiTiles(null, t).map(tile => tile.value)).toEqual([null, null])
  })
})
