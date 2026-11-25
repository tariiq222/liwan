import { describe, expect, it } from 'vitest'
import { isKpiTileActive, resolveKpiTileTo } from '@liwan/ui/app/utils/kpiTile'
import {
  departmentKpiTiles,
  employeeKpiTiles,
  hrEquipmentKpiQueries,
  hrEquipmentKpiTiles,
  hrInsurancePlanKpiQueries,
  hrInsurancePlanKpiTiles,
  hrLeaveKpiQueries,
  hrLeaveKpiTiles,
  hrPayrollRunKpiQueries,
  hrPayrollRunKpiTiles,
  hrShiftKpiQueries,
  hrShiftKpiTiles,
} from '../hrKpis'

const t = (key: string) => key
const n = (value: number) => String(value)
const tOps = (key: string) => `t:${key}`

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

describe('HR asset KPI tiles', () => {
  it('asks only for the server total of assigned and free assets', () => {
    expect(hrEquipmentKpiQueries()).toEqual({
      assigned: { assigned: 'true', limit: 1, offset: 0 },
      available: { assigned: 'false', limit: 1, offset: 0 },
    })
  })

  it('links each tile to the matching list filter and clears back to every asset', () => {
    const tiles = hrEquipmentKpiTiles({ assets: 12, assigned: 7, available: 5 }, tOps)
    expect(tiles.map(tile => [tile.id, tile.label, tile.value, tile.to, tile.clearTo, tile.tone])).toEqual([
      ['assets', 't:hrAssets.kpi.assets', 12, '/hr/assets', undefined, 'neutral'],
      ['assigned', 't:hrAssets.kpi.assigned', 7, '/hr/assets?assigned=true', '/hr/assets', 'neutral'],
      ['available', 't:hrAssets.kpi.available', 5, '/hr/assets?assigned=false', '/hr/assets', 'neutral'],
    ])
  })

  it('keeps a loading tile as null and leaves out an unknown one', () => {
    const tiles = hrEquipmentKpiTiles({ assets: null, assigned: undefined, available: 0 }, tOps)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['assets', null], ['available', 0]])
  })
})

describe('HR shift KPI tiles', () => {
  it('asks for every planned assignment and, once the day is known, that day', () => {
    const base = { employee_id: null, schedule_id: null, limit: 1, offset: 0 }
    expect(hrShiftKpiQueries('2026-11-25')).toEqual({
      planned: { ...base, on_date: null },
      today: { ...base, on_date: '2026-11-25' },
    })
    expect(hrShiftKpiQueries('').today.on_date).toBeNull()
  })

  it('links the day tile to that day and turns it success only when shifts run', () => {
    const tiles = hrShiftKpiTiles({ planned: 9, today: 3 }, '2026-11-25', tOps)
    expect(tiles.map(tile => [tile.id, tile.label, tile.value, tile.to, tile.clearTo, tile.tone])).toEqual([
      ['planned', 't:hrShifts.kpi.planned', 9, '/hr/shifts', undefined, 'neutral'],
      ['today', 't:hrShifts.kpi.today', 3, '/hr/shifts?on_date=2026-11-25', '/hr/shifts', 'success'],
    ])
    expect(hrShiftKpiTiles({ planned: 9, today: 0 }, '2026-11-25', tOps)[1]?.tone).toBe('neutral')
    expect(hrShiftKpiTiles({ planned: 9, today: null }, '2026-11-25', tOps)[1]).toMatchObject({ value: null, tone: 'neutral' })
  })

  it('drops the day tile while the company day is unknown', () => {
    expect(hrShiftKpiTiles({ planned: null, today: 4 }, '', tOps).map(tile => [tile.id, tile.value])).toEqual([['planned', null]])
    expect(hrShiftKpiTiles({ planned: 2 }, '2026-11-25', tOps).map(tile => tile.id)).toEqual(['planned'])
  })
})

describe('HR insurance plan KPI tiles', () => {
  it('asks for every plan, the active ones and the expired ones', () => {
    expect(hrInsurancePlanKpiQueries()).toEqual({
      all: { limit: 1, offset: 0 },
      active: { state: 'active', limit: 1, offset: 0 },
      expired: { state: 'expired', limit: 1, offset: 0 },
    })
  })

  it('keeps the plans section in every link and clears the state back to every plan', () => {
    const tiles = hrInsurancePlanKpiTiles({ all: 6, active: 4, expired: 2 }, tOps)
    expect(tiles.map(tile => [tile.id, tile.label, tile.value, tile.to, tile.clearTo, tile.tone])).toEqual([
      ['plans', 't:hrInsurance.kpi.plans', 6, '/hr/insurance?section=plans', undefined, 'neutral'],
      ['active', 't:hrInsurance.kpi.plansActive', 4, '/hr/insurance?section=plans&plan_state=active', '/hr/insurance?section=plans', 'success'],
      ['expired', 't:hrInsurance.kpi.plansExpired', 2, '/hr/insurance?section=plans&plan_state=expired', '/hr/insurance?section=plans', 'neutral'],
    ])
  })

  it('keeps loading figures as null and leaves out unknown ones', () => {
    const tiles = hrInsurancePlanKpiTiles({ all: null, active: undefined, expired: null }, tOps)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['plans', null], ['expired', null]])
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
