import { describe, expect, it } from 'vitest'
import { isKpiTileActive, resolveKpiTileTo } from '@liwan/ui/app/utils/kpiTile'
import { departmentKpiTiles, employeeKpiTiles, hrLeaveKpiQueries, hrLeaveKpiTiles, hrPayrollRunKpiQueries, hrPayrollRunKpiTiles } from '../hrKpis'

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

  it('links the pending tile to the list default without a clear target, and the approved tile nowhere', () => {
    const tiles = hrLeaveKpiTiles({ pending: 3, approved: undefined }, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.to, tile.clearTo])).toEqual([
      ['pending', 3, '/hr/leave', undefined],
      ['approved', null, undefined, undefined],
    ])
    expect(tiles[0]?.tone).toBe('warning')
    expect(hrLeaveKpiTiles({ pending: 0, approved: 4 }, t)[0]?.tone).toBe('neutral')
  })

  it('keeps the pending list when its active tile is clicked on the default view', () => {
    const tiles = hrLeaveKpiTiles({ pending: 3, approved: 1 }, t)
    const pending = tiles[0]!
    // `/hr/leave` is the list's own pending view, so the tile is already active on a first visit…
    expect(isKpiTileActive(pending, '/hr/leave')).toBe(true)
    // …and clicking it never flips the list to every request.
    expect(resolveKpiTileTo(pending, true, tiles)).toBe('/hr/leave')
  })

  it('lands on the pending list from ?scope=all', () => {
    const tiles = hrLeaveKpiTiles({ pending: 3, approved: 1 }, t)
    const pending = tiles[0]!
    expect(isKpiTileActive(pending, '/hr/leave?scope=all')).toBe(false)
    expect(resolveKpiTileTo(pending, false, tiles)).toBe('/hr/leave')
  })
})

describe('payroll run KPI tiles', () => {
  it('counts the runs with one row per request and no other filter', () => {
    expect(hrPayrollRunKpiQueries()).toEqual({
      all: { limit: 1, offset: 0 },
      draft: { state: 'draft', limit: 1, offset: 0 },
      computed: { state: 'computed', limit: 1, offset: 0 },
      approved: { state: 'approved', limit: 1, offset: 0 },
    })
  })

  it('filters the list by state and clears back to every run', () => {
    const tiles = hrPayrollRunKpiTiles({ all: 9, draft: 2, computed: 3, approved: 4 }, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.to, tile.clearTo])).toEqual([
      ['all', 9, '/hr/payroll', undefined],
      ['draft', 2, '/hr/payroll?state=draft', '/hr/payroll'],
      ['computed', 3, '/hr/payroll?state=computed', '/hr/payroll'],
      ['approved', 4, '/hr/payroll?state=approved', '/hr/payroll'],
    ])
    expect(tiles.find(tile => tile.id === 'computed')?.tone).toBe('warning')
    const computed = tiles.find(tile => tile.id === 'computed')!
    expect(isKpiTileActive(computed, '/hr/payroll?state=computed')).toBe(true)
    expect(resolveKpiTileTo(computed, true, tiles)).toBe('/hr/payroll')
  })

  it('shows dashes while loading and a quiet tone with nothing awaiting approval', () => {
    const tiles = hrPayrollRunKpiTiles({ all: null, draft: null, computed: 0, approved: null }, t)
    expect(tiles.map(tile => tile.value)).toEqual([null, null, 0, null])
    expect(tiles.find(tile => tile.id === 'computed')?.tone).toBe('neutral')
  })
})
