import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'

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
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
    useAccess: () => ({ can: () => true }),
    useMeeting: () => ({ data: meeting, isLoading: ref(false), error: ref(null), refetch: vi.fn() }),
    useMeetingAttachments: () => ({ data: ref({ items: [] }), isLoading: ref(false), isFetching: ref(false), error: ref(null), refetch: vi.fn() }),
    useResolutionAction: () => ({ mutateAsync: runResolution }),
    useMeetingAction: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    useUploadMeetingAttachment: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    useDeleteMeetingAttachment: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    useConvertResolution: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    useProjects: () => ({ data: ref([]), isLoading: ref(false), isFetching: ref(false), error: ref(null) }),
    safeReturnTo: (_value: unknown, fallback: string) => fallback,
    returnToQuery: () => ({}),
    formatLocalDateTime: (value: string | null) => value || '',
    filterMeetingResolutions: (items: unknown[]) => items,
    resolutionActions: () => ['start', 'complete', 'cancel', 'reopen'],
    ApiError: class ApiError extends Error {},
    navigateTo: vi.fn(),
    toast: { error: vi.fn() },
  }
  const scriptSource = parse(source('[id].vue')).descriptor.scriptSetup!.content
  const scriptFile = ts.createSourceFile('meeting-detail.ts', scriptSource, ts.ScriptTarget.Latest, true)
  const script = scriptFile.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(scriptFile)).join('\n')
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

function evaluatedMinutesPage(mutation = deferredMutation(), state = 'confirmed', canEdit = true, canManage = false) {
  const route = { params: { id: '7' }, query: { returnTo: '/meetings?q=review' }, fullPath: '/meetings/7/minutes?returnTo=%2Fmeetings%3Fq%3Dreview' }
  const meeting = ref({ id: 7, name: 'Operations review', state, can_edit: canEdit, can_manage: canManage, agenda: '<p>Agenda</p>', minutes: '<p>Minutes</p>' })
  const navigateTo = vi.fn(async () => {})
  const scope = {
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
    useMeeting: () => ({ data: meeting, isLoading: ref(false), error: ref(null), refetch: vi.fn() }),
    usePatchMeeting: () => mutation,
    safeReturnTo: (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback,
    navigateTo,
  }
  const pageState = editorScript('[id]/minutes.vue', scope, '{ save, agenda, minutes, dirty, lifecycleLocked, canEdit }')
  return { ...pageState, meeting, navigateTo, ...mutation }
}

function evaluatedSeriesSettingsPage(mutation = deferredMutation()) {
  const route = { params: { id: '12' }, query: { returnTo: '/meetings/series?q=weekly' }, fullPath: '/meetings/series/12/edit' }
  const series = ref({ id: 12, name: 'Weekly operations', can_edit: true, location: 'Room 1', meeting_url: 'https://meet.example.test/old', secretary: null, attendees: [], organizer: { id: 3, name: 'Tariq' }, recurrence: 'weekly', until_count: 4, until_date: null })
  const navigateTo = vi.fn(async () => {})
  const scope = {
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
    useMeetingSeries: () => ({ data: series, isLoading: ref(false), error: ref(null), refetch: vi.fn() }),
    usePatchMeetingSeriesSettings: () => mutation,
    formatCalendarDate: (value: string) => value,
    returnToQuery: (value: string) => ({ returnTo: value }),
    safeReturnTo: (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback,
    navigateTo,
  }
  const pageState = editorScript('series/[id]/edit.vue', scope, '{ save, name, meetingUrl, dirty, formErrors }')
  return { ...pageState, series, navigateTo, ...mutation }
}

function evaluatedGeneralEditPage(canEdit = true) {
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
  })
  const mutateAsync = vi.fn(async () => ({}))
  const navigateTo = vi.fn(async () => {})
  const scope = {
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
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
  return { ...pageState, mutateAsync, navigateTo }
}

describe('meeting editor routes and guards', () => {
  it('provides a dedicated minutes route with the narrow PATCH payload and preserved context', () => {
    const route = page('[id]/minutes.vue')
    expect(existsSync(route)).toBe(true)
    const content = source('[id]/minutes.vue')
    expect(content).toContain("body: { agenda: agenda.value, minutes: minutes.value, scope: 'this' }")
    expect(content).toContain('SharedUnsavedChanges')
    expect(content).toContain('returnTo')
    expect(content).toContain('aria-label')
    expect(content).toContain('can_edit')
  })

  it('keeps preparation editing separate from minutes editing', () => {
    const content = source('[id]/edit.vue')
    expect(content).not.toContain('const minutes = ref(')
    expect(content).not.toContain('v-model="minutes"')
    expect(source('[id].vue')).toContain('/minutes')
  })

  it('renders a completed meeting snapshot separately from current recommendations', () => {
    const content = source('[id].vue')
    expect(content).toContain('minutes_snapshot')
    expect(content).toContain('captured_at')
    expect(content).toContain('currentFollowUp')
    expect(content).toContain('currentPreviousFollowUp')
    expect(content).toContain('historyUnavailable')
  })

  it('protects resolution actions against duplicate requests while one is pending', () => {
    const content = source('[id].vue')
    expect(content).toContain('pendingResolutionIds')
    expect(content).toContain('finally')
    expect(content).toContain('pendingResolutionIds.has(item.id)')
  })

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

  it('saves minutes and returns directly to the preserved list context', async () => {
    const mutation = deferredMutation({})
    const editor = evaluatedMinutesPage(mutation)
    editor.minutes.value = '<p>Final minutes</p>'
    const save = editor.save()
    await nextTick()
    editor.release()
    await save
    expect(editor.mutateAsync).toHaveBeenCalledWith({ id: 7, body: { agenda: '<p>Agenda</p>', minutes: '<p>Final minutes</p>', scope: 'this' } })
    expect(editor.navigateTo).toHaveBeenCalledWith('/meetings?q=review')
  })

  it('explains the reopen requirement to an authorized manager while denying a non-editor', () => {
    const manager = evaluatedMinutesPage(deferredMutation(), 'done', false, true)
    const reader = evaluatedMinutesPage(deferredMutation(), 'cancelled', false, false)
    expect(manager.lifecycleLocked.value).toBe(true)
    expect(manager.canEdit.value).toBe(false)
    expect(reader.lifecycleLocked.value).toBe(true)
    expect(reader.canEdit.value).toBe(false)
  })

  it('saves series settings once and returns without nesting the detail URL', async () => {
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
    expect(editor.navigateTo).toHaveBeenCalledWith('/meetings/series?q=weekly')
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

  it('provides a dedicated series settings route with only default fields editable', () => {
    const route = page('series/[id]/edit.vue')
    expect(existsSync(route)).toBe(true)
    const content = source('series/[id]/edit.vue')
    expect(content).toContain('name')
    expect(content).toContain('location')
    expect(content).toContain('meeting_url')
    expect(content).toContain('v-model:secretary-id')
    expect(content).toContain('v-model:attendee-ids')
    expect(content).toContain('aria-readonly')
    expect(content).toContain('SharedUnsavedChanges')
    expect(source('series/[id].vue')).toContain('edit-settings')
    expect(source('series/[id].vue')).toContain('NuxtPage')
  })
})
