import * as recordNavigation from '../../utils/recordListOrigin'
import { meetingTabFromRoute, meetingTabQuery, isMeetingTab } from '../../utils/meetingTabs'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createMeetingMinutesForm, validateMeetingMinutesForm } from '../../utils/meetingMinutesForm'
import { parsePositiveId } from '../../utils/routeParams'
import { ApiError } from '../../composables/useApi'

const page = (relativePath: string) => resolve('app/pages/meetings', relativePath)
const source = (relativePath: string) => readFileSync(page(relativePath), 'utf8')

function evaluatedDetailPage() {
  const route = { path: '/meetings/7', fullPath: '/meetings/7', params: { id: '7' }, query: {} }
  const meeting = ref({
    id: 7,
    name: 'Operations review',
    can_edit: true,
    can_manage: true,
    state: 'confirmed',
    series_id: null,
    resolutions: [{
      id: 9,
      name: 'Confirm venue',
      state: 'open',
      task_id: null,
      can_update_execution: true,
      can_edit_decision: false,
    }],
  })
  let release!: () => void
  const pendingRequest = new Promise<void>(resolveRequest => { release = resolveRequest })
  const runResolution = vi.fn(() => pendingRequest)
  const scope = {
    ...recordNavigation,
    onBeforeUnmount: () => {},
    defineProps: () => ({ meeting: meeting.value, meetingId: 7 }),
    defineEmits: () => vi.fn(),
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    useRouter: () => ({ push: vi.fn() }),
    useI18n: () => ({ t: (key: string) => key, locale: ref('ar') }),
    useHydrated: () => ref(true),
    useSsrQuerySeed: () => {}, // Client workflow harness; actual SSR is tested separately.
    useMeetingSubmitError: () => ({ fieldErrors: computed(() => ({})), submitError: computed(() => '') }),
    useAccess: () => ({ can: () => true }),
    useResolutionAction: () => ({ mutateAsync: runResolution }),
    useConvertResolution: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    useProjects: () => ({ data: ref([]), isLoading: ref(false), isFetching: ref(false), error: ref(null) }),
    safeReturnTo: (_value: unknown, fallback: string) => fallback,
    returnToQuery: () => ({}),
    filterMeetingResolutions: (items: unknown[]) => items,
    resolutionActions: () => ['start', 'complete', 'cancel', 'reopen'],
    ApiError: class ApiError extends Error {},
    navigateTo: vi.fn(),
    useToast: () => ({ add: vi.fn() }),
  }
  const scriptSource = parse(source('../../components/meetings/MeetingResolutionsTab.vue')).descriptor.scriptSetup!.content
  const scriptFile = ts.createSourceFile('meeting-detail.ts', scriptSource, ts.ScriptTarget.Latest, true)
  const script = scriptFile.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(scriptFile)).join('\n').replaceAll('import.meta.client', 'false')
  const js = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const exposed = '{ requestResolutionAction, pendingResolutionIds }'
  const pageState = new Function(...Object.keys(scope), `${js}; return ${exposed}`)(...Object.values(scope)) as {
    requestResolutionAction: (resolutionId: number, action: 'start' | 'complete' | 'cancel' | 'reopen') => void
    pendingResolutionIds: { value: Set<number> }
  }
  return { ...pageState, release, runResolution }
}

function editorScript(relativePath: string, scope: Record<string, unknown>, exposed: string) {
  const scriptSource = parse(source(relativePath)).descriptor.scriptSetup!.content
  const scriptFile = ts.createSourceFile('editor.ts', scriptSource, ts.ScriptTarget.Latest, true)
  const script = scriptFile.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(scriptFile)).join('\n')
  const js = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return new Function(...Object.keys(scope), `${js}; return ${exposed}`)(...Object.values(scope)) as Record<string, any>
}

function deferredMutation(result: unknown = {}, shouldReject = false) {
  const isPending = ref(false)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const mutateAsync = vi.fn(async () => {
    isPending.value = true
    try {
      await gate
      if (shouldReject) throw new Error('save failed')
      return result
    } finally {
      isPending.value = false
    }
  })
  return { isPending, mutateAsync, release }
}

function evaluatedMinutesPage(mutation = deferredMutation(), state = 'confirmed', canEdit = true, canManage = false): Record<string, any> {
  const route = { params: { id: '7' }, query: { returnTo: '/meetings?q=review' }, fullPath: '/meetings/7/minutes?returnTo=%2Fmeetings%3Fq%3Dreview' }
  const meeting = ref({ id: 7, name: 'Operations review', state, can_edit: canEdit, can_manage: canManage, agenda: '<p>Agenda</p>', minutes: '<p>Minutes</p>', write_date: '2026-09-07T10:00:00Z' })
  const navigateTo = vi.fn(async () => {})
  const scope = {
    ...recordNavigation,
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    parsePositiveId,
    ApiError,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
    useSsrQuerySeed: () => {}, // Client workflow harness; actual SSR is tested separately.
    useMeetingSubmitError: () => ({ fieldErrors: computed(() => ({})), submitError: computed(() => '') }),
    useMeeting: () => ({ data: meeting, isLoading: ref(false), error: ref(null), refetch: vi.fn() }),
    usePatchMeeting: () => mutation,
    createMeetingMinutesForm,
    validateMeetingMinutesForm,
    navigateTo,
  }
  const pageState = editorScript('[id]/minutes.vue', scope, '{ save, agenda, minutes, minutesForm, dirty, lifecycleLocked, canEdit }')
  return { ...pageState, meeting, route, navigateTo, ...mutation }
}

function evaluatedSeriesSettingsPage(mutation = deferredMutation()): Record<string, any> {
  const route = { params: { id: '12' }, query: { returnTo: '/meetings/series?q=weekly' }, fullPath: '/meetings/series/12/edit' }
  const series = ref({ id: 12, name: 'Weekly operations', can_edit: true, location: 'Room 1', meeting_url: 'https://meet.example.test/old', secretary: null, attendees: [], organizer: { id: 3, name: 'Tariq' }, recurrence: 'weekly', until_count: 4, until_date: null })
  const navigateTo = vi.fn(async () => {})
  const scope = {
    ...recordNavigation,
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    parsePositiveId,
    ApiError,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
    useSsrQuerySeed: () => {}, // Client workflow harness; actual SSR is tested separately.
    useMeetingSubmitError: () => ({ fieldErrors: computed(() => ({})), submitError: computed(() => '') }),
    useMeetingSeries: () => ({ data: series, isLoading: ref(false), error: ref(null), refetch: vi.fn() }),
    usePatchMeetingSeriesSettings: () => mutation,
    formatCalendarDate: (value: string) => value,
    navigateTo,
  }
  const pageState = editorScript('series/[id]/edit.vue', scope, '{ save, name, meetingUrl, dirty, formErrors }')
  return { ...pageState, series, navigateTo, ...mutation }
}

function evaluatedGeneralEditPage(canEdit = true): Record<string, any> {
  const route = { params: { id: '7' }, query: { returnTo: '/meetings?q=review' }, fullPath: '/meetings/7/edit' }
  const meeting = ref({
    id: 7,
    name: 'Midnight review',
    meeting_date: '2026-09-07',
    start_datetime: '2026-09-07T21:30:00.000Z',
    end_datetime: '2026-09-07T22:30:00.000Z',
    can_edit: canEdit,
    location: 'Room 1',
    meeting_url: '',
    agenda: '<p>Agenda</p>',
    attendees: [],
    secretary: null,
    organizer: null,
    series_id: null,
    write_date: '2026-09-07T10:00:00Z',
  })
  const mutateAsync = vi.fn(async () => ({}))
  const navigateTo = vi.fn(async () => {})
  const scope = {
    ...recordNavigation,
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    parsePositiveId,
    ApiError,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
    useSsrQuerySeed: () => {}, // Client workflow harness; actual SSR is tested separately.
    useMeetingSubmitError: () => ({ fieldErrors: computed(() => ({})), submitError: computed(() => '') }),
    useMeeting: () => ({ data: meeting, isLoading: ref(false), error: ref(null), refetch: vi.fn() }),
    usePatchMeeting: () => ({ mutateAsync, isPending: ref(false), error: ref(null) }),
    safeReturnTo: (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback,
    buildMeetingSchedulePayload: () => ({ meeting_date: '2026-09-08', start_datetime: '2026-09-07T21:30:00.000Z', end_datetime: '2026-09-07T22:30:00.000Z' }),
    localDateFromUtc: (value: string | null | undefined) => value ? '2026-09-08' : '',
    localTimeFromUtc: (value: string | null | undefined) => value?.includes('21:30') ? '00:30' : '01:30',
    getMeetingFormErrors: (values: { name: string; date: string }) => ({
      ...(values.name.trim() ? {} : { name: 'required' }),
      ...(values.date ? {} : { date: 'required' }),
    }),
    navigateTo,
  }
  const pageState = editorScript('[id]/edit.vue', scope, '{ save, name, meetingDate, start, end, canEdit }')
  return { ...pageState, meeting, mutateAsync, navigateTo }
}

describe('meeting editor routes and guards', () => {




  it('does not issue a second resolution request while the first request is deferred', async () => {
    const detail = evaluatedDetailPage()
    detail.requestResolutionAction(9, 'start')
    detail.requestResolutionAction(9, 'start')

    expect(detail.runResolution).toHaveBeenCalledTimes(1)
    expect(detail.pendingResolutionIds.value.has(9)).toBe(true)

    detail.release()
    await nextTick()
    expect(detail.pendingResolutionIds.value.has(9)).toBe(false)
  })

  it('keeps a minutes draft dirty on error and blocks deferred duplicate saves', async () => {
    const mutation = deferredMutation({}, true)
    const editor = evaluatedMinutesPage(mutation)
    editor.agenda.value = '<p>Updated agenda</p>'
    const first = editor.save()
    await nextTick()
    const second = editor.save()
    expect(editor.mutateAsync).toHaveBeenCalledTimes(1)
    editor.release()
    await expect(first).rejects.toThrow('save failed')
    await second
    expect(editor.dirty.value).toBe(true)
    expect(editor.navigateTo).not.toHaveBeenCalled()
  })

  it('saves minutes and returns to its own meeting, ignoring the referrer', async () => {
    const mutation = deferredMutation({})
    const editor = evaluatedMinutesPage(mutation)
    editor.minutes.value = '<p>Final minutes</p>'
    const save = editor.save()
    await nextTick()
    editor.release()
    await save
    expect(editor.mutateAsync).toHaveBeenCalledWith({ id: 7, body: { agenda: '<p>Agenda</p>', minutes: '<p>Final minutes</p>', minutes_form: expect.any(Object), write_date: '2026-09-07T10:00:00Z', scope: 'this' } })
    // The route carries ?returnTo=/meetings?q=review. The minutes editor
    // belongs to one meeting, so that is where saving lands, and the referrer
    // is dropped instead of being copied onto the destination.
    expect(editor.navigateTo).toHaveBeenCalledWith({ path: '/meetings/7', query: {} })
  })

  it('saves the complete minutes draft before opening a new recommendation', async () => {
    const mutation = deferredMutation({})
    const editor = evaluatedMinutesPage(mutation)
    editor.agenda.value = '<p>Updated agenda</p>'
    editor.minutes.value = '<p>Updated minutes</p>'
    editor.minutesForm.value = createMeetingMinutesForm({
      opening: 'Opening',
      closing: 'Closing',
      chairperson: 'Chair',
      approver_name: 'Approver',
      approver_title: 'Director',
      topics: [{ key: 'topic-1', title: 'Topic', discussion: 'Discussion', project_id: 3, resolution_ids: [9] }],
    })
    const save = editor.save(true)
    await nextTick()
    editor.release()
    await save

    expect(editor.mutateAsync).toHaveBeenCalledWith({
      id: 7,
      body: {
        agenda: '<p>Updated agenda</p>',
        minutes: '<p>Updated minutes</p>',
        minutes_form: editor.minutesForm.value,
        write_date: '2026-09-07T10:00:00Z',
        scope: 'this',
      },
    })
    // The new resolution hangs off the same meeting; it needs no referrer to
    // find its way back, and one here would ride onto the meeting URL.
    expect(editor.navigateTo).toHaveBeenCalledWith('/meetings/7/resolutions/new')
  })

  it('explains the reopen requirement to an authorized manager while denying a non-editor', () => {
    const manager = evaluatedMinutesPage(deferredMutation(), 'done', false, true)
    const reader = evaluatedMinutesPage(deferredMutation(), 'cancelled', false, false)
    expect(manager.lifecycleLocked.value).toBe(true)
    expect(manager.canEdit.value).toBe(false)
    expect(reader.lifecycleLocked.value).toBe(true)
    expect(reader.canEdit.value).toBe(false)
  })

  it('saves series settings once and returns to its own series', async () => {
    const mutation = deferredMutation({})
    const editor = evaluatedSeriesSettingsPage(mutation)
    editor.name.value = 'Weekly operations updated'
    const save = editor.save()
    await nextTick()
    const second = editor.save()
    expect(editor.mutateAsync).toHaveBeenCalledTimes(1)
    editor.release()
    await save
    await second
    expect(editor.navigateTo).toHaveBeenCalledWith({ path: '/meetings/series/12', query: {} })
  })

  it('sends the revision the form opened on, even after a background refetch', async () => {
    const editor = evaluatedGeneralEditPage()
    editor.meeting.value = { ...editor.meeting.value, write_date: '2026-09-07T11:00:00Z' }
    editor.name.value = 'Renamed after refetch'
    await editor.save()
    expect(editor.mutateAsync.mock.calls[0][0].body.write_date).toBe('2026-09-07T10:00:00Z')
  })

  it('sends the revision the minutes editor opened on, even after a background refetch', async () => {
    const mutation = deferredMutation({})
    const editor = evaluatedMinutesPage(mutation)
    editor.meeting.value = { ...editor.meeting.value, write_date: '2026-09-07T11:00:00Z' }
    editor.minutes.value = '<p>Concurrent minutes</p>'
    const save = editor.save()
    await nextTick()
    editor.release()
    await save
    expect(editor.mutateAsync.mock.calls[0][0].body.write_date).toBe('2026-09-07T10:00:00Z')
  })

  it('does not rewrite an untouched near-midnight schedule during an unrelated edit', async () => {
    const editor = evaluatedGeneralEditPage()
    expect(editor.meetingDate.value).toBe('2026-09-08')
    expect(editor.start.value).toBe('00:30')
    editor.name.value = 'Midnight review renamed'
    await editor.save()
    const body = editor.mutateAsync.mock.calls[0][0].body
    expect(body.name).toBe('Midnight review renamed')
    expect(body).not.toHaveProperty('meeting_date')
    expect(body).not.toHaveProperty('start_datetime')
    expect(body).not.toHaveProperty('end_datetime')
  })

  it('does not save when the user explicitly clears the meeting date', async () => {
    const editor = evaluatedGeneralEditPage()
    editor.meetingDate.value = ''
    editor.name.value = 'Date must remain explicit'
    await editor.save()
    expect(editor.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not expose an active save for a meeting the user cannot edit', async () => {
    const editor = evaluatedGeneralEditPage(false)
    editor.name.value = 'Unauthorized edit'
    await editor.save()
    expect(editor.canEdit.value).toBe(false)
    expect(editor.mutateAsync).not.toHaveBeenCalled()
  })

})
