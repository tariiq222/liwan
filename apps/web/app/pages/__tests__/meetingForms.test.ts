import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMeetingSchedulePayload, fromUtcDateTimeInput, localDateFromUtc, localTimeFromUtc, toUtcDateTime } from '../../utils/meetingDateTime'
import { buildRecurrencePreview, getMeetingFormErrors, normalizeRecurrenceEnd } from '../../utils/meetingForm'

function form(file: string, routeQuery: Record<string, string> = {}, seriesInitiallyLoaded = true) {
  const source = readFileSync(resolve('app/pages/meetings', file), 'utf8')
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const meeting = ref({ id: 7, name: 'Review', meeting_date: '2026-09-07', start_datetime: null,
    end_datetime: null, location: '', meeting_url: '', agenda: '<p>Agenda</p>', minutes: '',
    attendees: [], secretary: null, series_id: null, can_edit: true })
  const series = ref({ id: 12, name: 'Weekly review', start_datetime: '2026-09-08T06:00:00.000Z',
    end_datetime: '2026-09-08T07:00:00.000Z', location: 'Room 1', meeting_url: 'https://meet.example', attendees: [{ id: 9, name: 'Amina' }], secretary: { id: 9, name: 'Amina' } })
  const seriesData = ref(seriesInitiallyLoaded ? series.value : null)
  const seriesLoading = ref(!seriesInitiallyLoaded)
  const mutateAsync = vi.fn(async () => ({ id: 7 }))
  const navigateTo = vi.fn(async () => {})
  const scope = { computed, ref, watch, nextTick, useRoute: () => ({ params: { id: '7' }, query: routeQuery }),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => ref(true),
    useAccess: () => ({ can: () => true }), usePeople: () => ({}),
    useMeeting: () => ({ data: meeting }),
    useMeetingSeries: () => ({ data: seriesData, isLoading: seriesLoading, error: ref(null) }),
    usePatchMeeting: () => ({ mutateAsync, isPending: ref(false) }),
    useCreateMeeting: () => ({ mutateAsync, isPending: ref(false) }),
    useCreateMeetingSeries: () => ({ mutateAsync, isPending: ref(false) }),
    useCreateResolution: () => ({ mutateAsync, isPending: ref(false) }),
    buildMeetingSchedulePayload, buildRecurrencePreview, fromUtcDateTimeInput, getMeetingFormErrors,
    localDateFromUtc, localTimeFromUtc, toUtcDateTime, normalizeRecurrenceEnd,
    safeReturnTo: (_: unknown, fallback: string) => fallback, returnToQuery: () => ({}), navigateTo }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const exposed = file === 'series/new.vue'
    ? '{ dirty, name, save, recurrence, untilCount, untilDate, start, end, attendeeIds, meetingUrl }'
    : `{ dirty, name, save, ${file.includes('resolutions') ? 'responsibleId, deadline, priority' : 'meetingDate, end, start, attendeeIds, secretaryId, location, meetingUrl'} }`
  return { ...new Function(...Object.keys(scope), `${js}; return ${exposed}`)(...Object.values(scope)), mutateAsync, navigateTo, series, seriesData, seriesLoading }
}

describe('meeting form unsaved changes', () => {
  const originalTimezone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Asia/Riyadh' })
  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

  it('edit starts clean, detects changes and becomes clean after saving', async () => {
    const page = form('[id]/edit.vue')
    expect(page.dirty.value).toBe(false)
    page.name.value = 'Changed'
    expect(page.dirty.value).toBe(true)
    await page.save()
    expect(page.dirty.value).toBe(false)
    expect(page.navigateTo).toHaveBeenCalled()
    expect(page.mutateAsync.mock.calls[0][0].body.agenda).toBe('<p>Agenda</p>')
  })
  it('new meeting tracks the end time and clears dirty after successful creation', async () => {
    const page = form('new.vue')
    page.meetingDate.value = '2026-09-07'
    page.end.value = '2026-09-07T16:30'
    expect(page.dirty.value).toBe(true)
    page.name.value = 'Created'
    await page.save()
    expect(page.dirty.value).toBe(false)
  })
  it('preserves project context when creating from a project-filtered list', async () => {
    const page = form('new.vue', { project_id: '42' })
    page.meetingDate.value = '2026-09-07'
    page.name.value = 'Project review'
    await page.save()
    expect(page.mutateAsync.mock.calls[0][0].project_id).toBe(42)
  })
  it('serializes standalone datetime-local values as UTC instants', async () => {
    const page = form('new.vue')
    page.meetingDate.value = '2026-09-08'
    page.name.value = 'Created'
    page.start.value = '2026-09-08T09:00'
    page.end.value = '2026-09-08T10:00'
    await page.save()
    const body = page.mutateAsync.mock.calls[0][0]
    expect(body.start_datetime).toBe('2026-09-08T09:00:00+03:00')
    expect(body.end_datetime).toBe('2026-09-08T10:00:00+03:00')
    expect(new Date(body.start_datetime).toISOString()).toBe('2026-09-08T06:00:00.000Z')
    expect(new Date(body.end_datetime).toISOString()).toBe('2026-09-08T07:00:00.000Z')
    expect(body.start_datetime.slice(0, 10)).toBe('2026-09-08')
    expect(body.start_datetime).toMatch(/[+-]03:00$/)
  })
  it('does not save a named meeting with an explicitly empty date', async () => {
    const page = form('new.vue')
    page.name.value = 'Missing date'
    page.meetingDate.value = ''
    await page.save()
    expect(page.mutateAsync).not.toHaveBeenCalled()
  })
  it('serializes edited datetime-local values as UTC instants', async () => {
    const page = form('[id]/edit.vue')
    await nextTick()
    page.meetingDate.value = '2026-09-08'
    page.start.value = '09:00'
    page.end.value = '10:00'
    await page.save()
    const body = page.mutateAsync.mock.calls[0][0].body
    expect(body.start_datetime).toBe('2026-09-08T09:00:00+03:00')
    expect(body.end_datetime).toBe('2026-09-08T10:00:00+03:00')
    expect(new Date(body.start_datetime).toISOString()).toBe('2026-09-08T06:00:00.000Z')
    expect(new Date(body.end_datetime).toISOString()).toBe('2026-09-08T07:00:00.000Z')
  })
  it('loads series defaults without overwriting an explicit attendee edit', async () => {
    const page = form('new.vue', { series_id: '12' })
    await nextTick()
    expect(page.attendeeIds.value).toEqual([9])
    page.attendeeIds.value = [11]
    page.series.value = { ...page.series.value, attendees: [{ id: 9, name: 'Amina' }] }
    await nextTick()
    expect(page.attendeeIds.value).toEqual([11])
  })
  it('keeps an explicit empty attendee selection after series defaults load', async () => {
    const page = form('new.vue', { series_id: '12' })
    page.meetingDate.value = '2026-09-08'
    await nextTick()
    page.name.value = 'Project review'
    page.attendeeIds.value = []
    page.secretaryId.value = null
    page.location.value = ''
    page.meetingUrl.value = ''
    await nextTick()
    await page.save()
    expect(page.mutateAsync.mock.calls[0][0].attendee_ids).toEqual([])
    expect(page.mutateAsync.mock.calls[0][0].secretary_id).toBeNull()
    expect(page.mutateAsync.mock.calls[0][0].location).toBe('')
    expect(page.mutateAsync.mock.calls[0][0].meeting_url).toBe('')
  })
  it('keeps a user draft dirty when series defaults arrive asynchronously', async () => {
    const page = form('new.vue', { series_id: '12' }, false)
    page.name.value = 'Draft before load'
    page.seriesData.value = page.series.value
    page.seriesLoading.value = false
    await nextTick()
    expect(page.name.value).toBe('Draft before load')
    expect(page.dirty.value).toBe(true)
  })
  it('serializes recurring series times and sends only the selected termination mode', async () => {
    const page = form('series/new.vue')
    page.name.value = 'Weekly review'
    page.recurrence.value = 'weekly'
    page.start.value = '2026-09-08T09:00'
    page.end.value = '2026-09-08T10:00'
    page.untilCount.value = '6'
    page.untilDate.value = '2026-12-31'
    page.meetingUrl.value = 'https://series.example'
    await page.save()
    const body = page.mutateAsync.mock.calls[0][0]
    expect(body.start_datetime).toMatch(/Z$/)
    expect(body.until_count).toBe(6)
    expect(body.until_date).toBeUndefined()
    expect(body.meeting_url).toBe('https://series.example')
  })
  it('inherits unrelated series defaults when only the start was edited before loading', async () => {
    const page = form('new.vue', { series_id: '12' }, false)
    page.start.value = '2026-09-08T09:00'
    page.seriesData.value = page.series.value
    page.seriesLoading.value = false
    await nextTick()
    expect(page.location.value).toBe('Room 1')
    expect(page.meetingUrl.value).toBe('https://meet.example')
  })
  it('preserves an explicit URL clear when series defaults arrive', async () => {
    const page = form('new.vue', { series_id: '12' }, false)
    page.meetingUrl.value = 'https://custom.example'
    page.meetingUrl.value = ''
    page.seriesData.value = page.series.value
    page.seriesLoading.value = false
    await nextTick()
    expect(page.meetingUrl.value).toBe('')
  })
  it('resolution tracks priority and clears dirty after successful creation', async () => {
    const page = form('[id]/resolutions/new.vue')
    page.priority.value = '3'
    expect(page.dirty.value).toBe(true)
    page.name.value = 'Follow up'
    page.responsibleId.value = 9
    page.deadline.value = '2026-09-10'
    await page.save()
    expect(page.dirty.value).toBe(false)
  })
})
