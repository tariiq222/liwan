import { describe, expect, it } from 'vitest'
import { followupKpiStates, kpiLink, meetingFollowupTiles, meetingKpiFilters, meetingListTiles, meetingSeriesTiles, monthDayRange, pickNearestUpcomingMeeting } from '../meetingKpis'

const t = (key: string) => `t:${key}`

describe('meeting KPI filters', () => {
  it('format the month that holds today', () => {
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
    const tiles = meetingListTiles({ total: 5, upcoming: 0, draft: undefined, done: 2 }, links, t, { upcoming: 'Today · 10:00' })
    expect(tiles.map(tile => [tile.id, tile.value, tile.to])).toEqual([['total', 5, '/a'], ['upcoming', 0, '/b'], ['draft', null, '/c'], ['done', 2, '/d']])
    expect(tiles[0]?.label).toBe('t:meetingsKpi.total')
    expect(tiles[1]?.hint).toBe('Today · 10:00')
    expect(tiles[2]?.hint).toBeUndefined()
    expect(tiles[3]?.hint).toBe('t:meetingsKpi.doneMonthHint')
    expect(meetingListTiles({ total: 5, upcoming: 1, draft: 2, done: 0 }, links, t)[2]?.hint).toBe('t:meetingsKpi.draftHint')
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

describe('pickNearestUpcomingMeeting', () => {
  const descItems = [
    { id: 30, meeting_date: '2026-11-15', start_datetime: '2026-11-15T10:00:00Z' },
    { id: 22, meeting_date: '2026-10-20', start_datetime: '2026-10-20T14:00:00Z' },
    { id: 19, meeting_date: '2026-10-20', start_datetime: '2026-10-20T09:00:00Z' },
    { id: 18, meeting_date: '2026-10-20', start_datetime: '2026-10-20T09:00:00Z' },
  ]

  it('picks the earliest upcoming meeting from a meeting_date desc response', () => {
    expect(pickNearestUpcomingMeeting({ items: descItems, total: descItems.length })).toEqual(descItems[3])
  })

  it('returns null when disabled even if cached data exists', () => {
    expect(pickNearestUpcomingMeeting({ items: descItems, total: descItems.length }, false)).toBeNull()
  })

  it('returns null when the server response is truncated so it never guesses the wrong meeting', () => {
    expect(pickNearestUpcomingMeeting({ items: descItems, total: descItems.length + 1 })).toBeNull()
  })

  it('returns null for missing or empty data', () => {
    expect(pickNearestUpcomingMeeting(undefined)).toBeNull()
    expect(pickNearestUpcomingMeeting({ items: [], total: 0 })).toBeNull()
  })
})
