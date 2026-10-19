import { describe, expect, it } from 'vitest'
import { followupKpiStates, kpiLink, localIsoDay, meetingFollowupTiles, meetingKpiFilters, meetingListTiles, meetingSeriesTiles, monthDayRange } from '../meetingKpis'

const t = (key: string) => `t:${key}`

describe('meeting KPI filters', () => {
  it('format local days and the month that holds today', () => {
    expect(localIsoDay(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(monthDayRange(new Date(2026, 1, 14))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthDayRange(new Date(2028, 1, 14))).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('gives each tile its own state and dates on top of the page scope', () => {
    const filters = meetingKpiFilters(new Date(2026, 9, 20))
    expect(filters.total).toEqual({})
    expect(filters.upcoming).toEqual({ state: 'confirmed', date_from: '2026-10-20' })
    expect(filters.draft).toEqual({ state: 'draft' })
    expect(filters.done).toEqual({ state: 'done', date_from: '2026-10-01', date_to: '2026-10-31' })
  })

  it('builds links that drop empty values and write booleans as 1', () => {
    expect(kpiLink('/meetings', {})).toBe('/meetings')
    expect(kpiLink('/meetings', { q: '', mine: true, state: 'draft', project_id: 4, series_id: undefined, organizer_id: undefined })).toBe('/meetings?mine=1&state=draft&project_id=4')
    expect(kpiLink('/meetings', { mine: false })).toBe('/meetings')
  })
})

describe('meeting KPI tiles', () => {
  it('show a dash for counts that have not arrived and the server total otherwise', () => {
    const links = { total: '/a', upcoming: '/b', draft: '/c', done: '/d' }
    const tiles = meetingListTiles({ total: 5, upcoming: 0, draft: undefined, done: 2 }, links, t)
    expect(tiles.map(tile => [tile.id, tile.value, tile.to])).toEqual([['total', 5, '/a'], ['upcoming', 0, '/b'], ['draft', null, '/c'], ['done', 2, '/d']])
    expect(tiles[0]?.label).toBe('t:meetingsKpi.total')
  })

  it('mark the series resolution tiles as company-wide and link them to the follow-up filters', () => {
    const tiles = meetingSeriesTiles({ series: 3, open: 7 }, t)
    expect(tiles.map(tile => tile.value)).toEqual([3, 7, null])
    expect(tiles[0]?.hint).toBeUndefined()
    expect(tiles[1]).toMatchObject({ hint: 't:meetingsKpi.allMeetings', to: '/meetings/follow-up?state=active' })
    expect(tiles[2]).toMatchObject({ hint: 't:meetingsKpi.allMeetings', to: '/meetings/follow-up?state=overdue', tone: 'danger' })
  })

  it('keep the follow-up scope in every link and one tile per state', () => {
    const tiles = meetingFollowupTiles({ all: 9, active: 4, overdue: 1 }, { q: 'x', mine: true }, t)
    expect(tiles.map(tile => tile.id)).toEqual([...followupKpiStates])
    expect(tiles.map(tile => tile.value)).toEqual([9, 4, 1, null])
    expect(tiles[2]?.to).toBe('/meetings/follow-up?q=x&mine=1&state=overdue')
  })
})
