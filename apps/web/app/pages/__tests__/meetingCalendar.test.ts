import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { calendarCoverage } from '../../utils/meetingWorkspace'
import { meetingStateBadgeProps } from '../../utils/meetingStatus'
import { parseMeetingListFilters, patchMeetingListQuery } from '../../utils/meetingListFilters'
import { isCalendarDate } from '@nasq/ui/app/composables/calendarDate'
import { firstQuery } from '../../utils/routeQuery'

type CalendarMeeting = {
  id: number
  name: string
  state: string
  meeting_date: string | null
  start_datetime: string | null
  end_datetime: string | null
}

function meeting(overrides: Partial<CalendarMeeting> & { id: number }): CalendarMeeting {
  return { name: `Meeting ${overrides.id}`, state: 'confirmed', meeting_date: null, start_datetime: null, end_datetime: null, ...overrides }
}

function calendar(items: CalendarMeeting[], routeQuery: Record<string, string> = {}, localeCode = 'ar') {
  const source = readFileSync(resolve('app/pages/meetings/calendar.vue'), 'utf8')
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const route = reactive({ query: { ...routeQuery }, fullPath: '/meetings/calendar' })
  const replace = vi.fn()
  const useMeetings = vi.fn((_params: unknown) => ({ data: ref({ items, total: items.length }), isLoading: ref(false), error: ref(null), refetch: vi.fn() }))
  const scope = {
    computed, ref, watch,
    useRoute: () => route,
    useRouter: () => ({ replace, resolve: (to: unknown) => to }),
    useI18n: () => ({ t: (key: string) => key, locale: ref(localeCode) }),
    useHydrated: () => ref(true),
    useAccess: () => ({ can: () => true }),
    useMeetings, calendarCoverage, meetingStateBadgeProps, parseMeetingListFilters, patchMeetingListQuery, firstQuery, isCalendarDate,
    formatCalendarDate: (value: string) => value, formatNasqTime: () => '', formatLocalDateTime: (value: string) => value,
  }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const exposed = '{ byDate, agenda, shift, weekStart, year, month, selectedMeetings, selectedDay, onStateChange }'
  const page = new Function(...Object.keys(scope), `${js}; return ${exposed}`)(...Object.values(scope))
  const params = () => (useMeetings.mock.calls[0]![0] as { value: Record<string, unknown> }).value
  return { ...page, route, replace, params }
}

const idsOn = (page: ReturnType<typeof calendar>, day: string) => (page.byDate.value.get(day) ?? []).map((item: { id: number }) => item.id)

describe('meetings calendar page', () => {
  const originalTimezone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Asia/Riyadh' })
  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })
  afterEach(() => { vi.useRealTimers() })

  it('buckets a date-only meeting under its meeting date', () => {
    const page = calendar([meeting({ id: 1, meeting_date: '2026-03-10' })], { year: '2026', month: '3' })
    expect(idsOn(page, '2026-03-10')).toEqual([1])
    expect(page.byDate.value.size).toBe(1)
  })

  it('shows a multi-day meeting on every local day it covers', () => {
    // 23:00 on Mar 10 to 08:00 on Mar 12 in Riyadh.
    const page = calendar([meeting({ id: 2, meeting_date: '2026-03-10', start_datetime: '2026-03-10T20:00:00Z', end_datetime: '2026-03-12T05:00:00Z' })], { year: '2026', month: '3' })
    expect(idsOn(page, '2026-03-09')).toEqual([])
    expect(idsOn(page, '2026-03-10')).toEqual([2])
    expect(idsOn(page, '2026-03-11')).toEqual([2])
    expect(idsOn(page, '2026-03-12')).toEqual([2])
    expect(idsOn(page, '2026-03-13')).toEqual([])
  })

  it('clips a multi-day meeting to the displayed month', () => {
    const page = calendar([meeting({ id: 3, meeting_date: '2026-03-30', start_datetime: '2026-03-30T06:00:00Z', end_datetime: '2026-04-02T06:00:00Z' })], { year: '2026', month: '3' })
    expect([...page.byDate.value.keys()].sort()).toEqual(['2026-03-30', '2026-03-31'])
  })

  it('falls back to the meeting date when the end precedes the start', () => {
    const page = calendar([meeting({ id: 4, meeting_date: '2026-03-10', start_datetime: '2026-03-10T06:00:00Z', end_datetime: '2026-03-09T06:00:00Z' })], { year: '2026', month: '3' })
    expect([...page.byDate.value.keys()]).toEqual(['2026-03-10'])
  })

  it('falls back to the meeting date when the covered days come out empty', () => {
    // Local days Mar 10 (23:30) .. Mar 10 minus midnight rule leaves nothing for a zero-length range at midnight.
    const page = calendar([meeting({ id: 6, meeting_date: '2026-03-10', start_datetime: '2026-03-09T21:00:00Z', end_datetime: '2026-03-09T21:00:00Z' })], { year: '2026', month: '3' })
    expect([...page.byDate.value.keys()]).toEqual(['2026-03-10'])
  })

  it('shows a meeting that starts in the previous month on the days it covers and fetches 7 days earlier', () => {
    const page = calendar([meeting({ id: 7, meeting_date: '2026-09-30', start_datetime: '2026-09-30T20:00:00Z', end_datetime: '2026-10-02T05:00:00Z' })], { year: '2026', month: '10' })
    expect(page.params().date_from).toBe('2026-09-24')
    expect(page.params().date_to).toBe('2026-10-31')
    expect(idsOn(page, '2026-09-30')).toEqual([])
    expect(idsOn(page, '2026-10-01')).toEqual([7])
    expect(idsOn(page, '2026-10-02')).toEqual([7])
    expect(page.agenda.value.map((item: { id: number }) => item.id)).toEqual([7])
  })

  it('does not cover the next day when a meeting ends exactly at local midnight', () => {
    // 2026-03-10 22:00 to 2026-03-12 00:00 in Riyadh.
    const page = calendar([meeting({ id: 8, meeting_date: '2026-03-10', start_datetime: '2026-03-10T19:00:00Z', end_datetime: '2026-03-11T21:00:00Z' })], { year: '2026', month: '3' })
    expect([...page.byDate.value.keys()].sort()).toEqual(['2026-03-10', '2026-03-11'])
  })

  it('restores the selected month and day when browser history changes query', async () => {
    const page = calendar([], { year: '2026', month: '9', day: '2026-09-15' })
    page.route.query = { year: '2026', month: '10', day: '2026-10-20' }
    await nextTick()
    expect([page.year.value, page.month.value, page.selectedDay.value]).toEqual([2026, 9, '2026-10-20'])
  })

  it('rejects an impossible or out-of-month day query', () => {
    expect(calendar([], { year: '2026', month: '2', day: '2026-02-31' }).selectedDay.value).toBeNull()
    expect(calendar([], { year: '2026', month: '3', day: '2026-04-01' }).selectedDay.value).toBeNull()
    expect(calendar([], { year: '2026', month: '3', day: '2026-03-15' }).selectedDay.value).toBe('2026-03-15')
  })

  it('stops shifting at the year bounds', () => {
    const first = calendar([], { year: '1970', month: '1' })
    first.shift(-1)
    expect([first.year.value, first.month.value]).toEqual([1970, 0])
    const last = calendar([], { year: '2100', month: '12' })
    last.shift(1)
    expect([last.year.value, last.month.value]).toEqual([2100, 11])
    last.shift(-1)
    expect([last.year.value, last.month.value]).toEqual([2100, 10])
  })

  it('keeps a lookback meeting that ended before the month out of the agenda', () => {
    const page = calendar([
      meeting({ id: 9, meeting_date: '2026-09-25', start_datetime: '2026-09-25T06:00:00Z', end_datetime: '2026-09-26T06:00:00Z' }),
      meeting({ id: 10, meeting_date: '2026-10-05', start_datetime: '2026-10-05T06:00:00Z', end_datetime: '2026-10-05T07:00:00Z' }),
    ], { year: '2026', month: '10' })
    expect(page.agenda.value.map((item: { id: number }) => item.id)).toEqual([10])
  })

  it('lists the meetings covering the selected day', () => {
    const page = calendar([meeting({ id: 5, meeting_date: '2026-03-10', start_datetime: '2026-03-10T06:00:00Z', end_datetime: '2026-03-11T06:00:00Z' })], { year: '2026', month: '3', day: '2026-03-11' })
    expect(page.selectedMeetings.value.map((item: { id: number }) => item.id)).toEqual([5])
  })

  it('sends route filters to the meetings query', () => {
    const page = calendar([], { year: '2026', month: '3', state: 'done', mine: '1', project_id: '4' })
    expect(page.params()).toMatchObject({ state: 'done', mine: true, project_id: 4, date_from: '2026-02-22', date_to: '2026-03-31' })
  })

  it('keeps the month and the other filters in the URL when a filter changes', () => {
    const page = calendar([], { year: '2026', month: '3', mine: '1', project_id: '4' })
    page.replace.mockClear()
    page.onStateChange('confirmed')
    expect(page.replace).toHaveBeenCalledTimes(1)
    expect(page.replace.mock.calls[0]![0].query).toMatchObject({ year: '2026', month: '3', mine: '1', project_id: '4', state: 'confirmed' })
  })

  it('starts the week on Sunday in Arabic and Monday otherwise', () => {
    expect(calendar([], { year: '2026', month: '3' }, 'ar').weekStart.value).toBe(0)
    expect(calendar([], { year: '2026', month: '3' }, 'en').weekStart.value).toBe(1)
  })

  it('falls back to the current month for an out-of-range year or month', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-15T09:00:00Z'))
    for (const query of [{ year: '99999', month: '13' }, { year: '2026', month: '13' }, { year: '1969', month: '5' }]) {
      const page = calendar([], query)
      expect([page.year.value, page.month.value]).toEqual([2026, 4])
    }
  })
})
