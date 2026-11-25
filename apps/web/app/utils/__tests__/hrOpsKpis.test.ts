import { describe, expect, it } from 'vitest'
import {
  hrEquipmentKpiQueries,
  hrEquipmentKpiTiles,
  hrInsurancePlanKpiQueries,
  hrInsurancePlanKpiTiles,
  hrShiftKpiQueries,
  hrShiftKpiTiles,
} from '../hrOpsKpis'

const t = (key: string) => `t:${key}`

describe('HR asset KPI tiles', () => {
  it('asks only for the server total of assigned and free assets', () => {
    expect(hrEquipmentKpiQueries()).toEqual({
      assigned: { assigned: 'true', limit: 1, offset: 0 },
      available: { assigned: 'false', limit: 1, offset: 0 },
    })
  })

  it('links each tile to the matching list filter and clears back to every asset', () => {
    const tiles = hrEquipmentKpiTiles({ assets: 12, assigned: 7, available: 5 }, t)
    expect(tiles.map(tile => [tile.id, tile.label, tile.value, tile.to, tile.clearTo, tile.tone])).toEqual([
      ['assets', 't:hrAssets.kpi.assets', 12, '/hr/assets', undefined, 'neutral'],
      ['assigned', 't:hrAssets.kpi.assigned', 7, '/hr/assets?assigned=true', '/hr/assets', 'neutral'],
      ['available', 't:hrAssets.kpi.available', 5, '/hr/assets?assigned=false', '/hr/assets', 'neutral'],
    ])
  })

  it('keeps a loading tile as null and leaves out an unknown one', () => {
    const tiles = hrEquipmentKpiTiles({ assets: null, assigned: undefined, available: 0 }, t)
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
    const tiles = hrShiftKpiTiles({ planned: 9, today: 3 }, '2026-11-25', t)
    expect(tiles.map(tile => [tile.id, tile.label, tile.value, tile.to, tile.clearTo, tile.tone])).toEqual([
      ['planned', 't:hrShifts.kpi.planned', 9, '/hr/shifts', undefined, 'neutral'],
      ['today', 't:hrShifts.kpi.today', 3, '/hr/shifts?on_date=2026-11-25', '/hr/shifts', 'success'],
    ])
    expect(hrShiftKpiTiles({ planned: 9, today: 0 }, '2026-11-25', t)[1]?.tone).toBe('neutral')
    expect(hrShiftKpiTiles({ planned: 9, today: null }, '2026-11-25', t)[1]).toMatchObject({ value: null, tone: 'neutral' })
  })

  it('drops the day tile while the company day is unknown', () => {
    expect(hrShiftKpiTiles({ planned: null, today: 4 }, '', t).map(tile => [tile.id, tile.value])).toEqual([['planned', null]])
    expect(hrShiftKpiTiles({ planned: 2 }, '2026-11-25', t).map(tile => tile.id)).toEqual(['planned'])
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
    const tiles = hrInsurancePlanKpiTiles({ all: 6, active: 4, expired: 2 }, t)
    expect(tiles.map(tile => [tile.id, tile.label, tile.value, tile.to, tile.clearTo, tile.tone])).toEqual([
      ['plans', 't:hrInsurance.kpi.plans', 6, '/hr/insurance?section=plans', undefined, 'neutral'],
      ['active', 't:hrInsurance.kpi.plansActive', 4, '/hr/insurance?section=plans&plan_state=active', '/hr/insurance?section=plans', 'success'],
      ['expired', 't:hrInsurance.kpi.plansExpired', 2, '/hr/insurance?section=plans&plan_state=expired', '/hr/insurance?section=plans', 'neutral'],
    ])
  })

  it('keeps loading figures as null and leaves out unknown ones', () => {
    const tiles = hrInsurancePlanKpiTiles({ all: null, active: undefined, expired: null }, t)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['plans', null], ['expired', null]])
  })
})
