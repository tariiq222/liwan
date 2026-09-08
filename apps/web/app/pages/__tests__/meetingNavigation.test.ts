import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { formatLocalDateTime } from '../../utils/meetingDateTime'
import { meetingCreateRoute } from '../../utils/meetingRoutes'
import { clearMeetingListFilters, parseMeetingListFilters, patchMeetingListQuery } from '../../utils/meetingListFilters'
import { resolutionActions } from '../../utils/meetingWorkspace'

function page(file: string, pmo = false, routeOverride: Record<string, unknown> = {}) {
  const source = parse(readFileSync(resolve('app/pages/meetings', file), 'utf8')).descriptor.scriptSetup!.content
  const route = { path: '/meetings/7', fullPath: '/meetings/7', params: { id: '7' },
    ...routeOverride, query: { q: 'review', offset: '25', ...(routeOverride.query as Record<string, unknown> | undefined) } }
  const replace = vi.fn(async ({ query }) => { route.query = query })
  const projects = vi.fn(() => ({ data: ref([{ id: 3, name: 'Valid project' }]) }))
  const people = vi.fn(() => ({ data: ref([{ id: 3, user_id: 3, name: 'Valid organizer' }]), isLoading: ref(false), error: ref(null), refetch: vi.fn() }))
  const seriesList = vi.fn(() => ({ data: ref({ total: 120, items: [] }), isLoading: ref(false), error: ref(null), refetch: vi.fn() }))
  const mutateAsync = vi.fn(async () => { throw new Error('backend unavailable') })
  const meetingData = ref({ id: 7, can_edit: true, can_manage: true, state: 'draft', series_id: null,
    resolutions: [{ id: 9, can_update_execution: true, can_edit_decision: false, task_id: null, state: 'open', allowed_actions: ['start', 'complete', 'cancel'] }] })
  const meetingMutation = vi.fn(async () => undefined)
  const resolutionMutation = vi.fn(async () => undefined)
  const scope = { ref, computed, watch, useRoute: () => route, useRouter: () => ({ replace, push: vi.fn() }),
    refDebounced,
    useI18n: () => ({ t: (key: string) => key, locale: ref('ar') }), useHydrated: () => ref(true),
    useAccess: () => ({ can: () => pmo }), useProjects: projects,
    useMeetings: () => ({ data: ref({ total: 60 }), isFetching: ref(false) }),
    useMeetingSeriesList: seriesList, usePeople: people, meetingCreateRoute, formatLocalDateTime,
    clearMeetingListFilters, parseMeetingListFilters, patchMeetingListQuery,
    useMeeting: () => ({ data: meetingData }), useMeetingAttachments: () => ({}),
    useUploadMeetingAttachment: () => ({}), useDeleteMeetingAttachment: () => ({}),
    useConvertResolution: () => ({ mutateAsync }),
    useMeetingAction: () => ({ mutateAsync: meetingMutation, isPending: ref(false) }),
    useResolutionAction: () => ({ mutateAsync: resolutionMutation }), resolutionActions,
    safeReturnTo: (_: unknown, fallback: string) => fallback, ApiError: class ApiError extends Error {},
    navigateTo: vi.fn(), toast: { error: vi.fn() } }
  const ast = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true)
  const script = ast.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(ast)).join('\n')
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const exposed = file === 'index.vue'
    ? '{ setPage, offset, createMeetingTo }'
    : file === '[id].vue'
      ? '{ convertResolution, projectByResolution, localTime, resolutionCanReopen, requestMeetingAction, confirmMeetingAction, pendingMeetingAction, requestResolutionAction, confirmResolutionAction, pendingResolutionAction, error: () => typeof conversionError === "undefined" ? null : conversionError.value }'
      : file === 'series/index.vue'
        ? '{ search, offset, pages, params }'
        : '{ convertResolution, projectByResolution, error: () => typeof conversionError === "undefined" ? null : conversionError.value }'
  return { ...new Function(...Object.keys(scope), `${js};return ${exposed}`)(...Object.values(scope)), route, meeting: meetingData, projects, seriesList, replace, mutateAsync: meetingMutation, resolutionMutation }
}

describe('meeting route and conversion behavior', () => {
  const originalTimezone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Asia/Riyadh' })
  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

  it('removes the old offset on page one and preserves search for refresh/back', () => {
    const list = page('index.vue')
    list.setPage(1)
    expect(list.route.query.offset).toBeUndefined()
    expect(list.route.query.q).toBe('review')
    expect(list.offset.value).toBe(0)
  })
  it('carries project context into the actual create link used by the meetings page', () => {
    const list = page('index.vue', false, { fullPath: '/meetings?project_id=42', query: { project_id: '42' } })
    expect(list.createMeetingTo.value).toEqual({
      path: '/meetings/new',
      query: { project_id: '42', returnTo: '/meetings?project_id=42' },
    })
  })
  it('does not enable project lookup for a meetings-only editor', () => {
    const detail = page('[id].vue')
    expect(detail.projects.mock.calls[0]?.[0]?.value).toBe(false)
  })
  it('shows a localized inline conversion failure', async () => {
    const detail = page('[id].vue', true)
    detail.projectByResolution.value[9] = 3
    await expect(detail.convertResolution(9)).resolves.toBeUndefined()
    expect(detail.error()).toBe('meetingsUi.convertError')
  })

  it('requires explicit confirmation before cancelling a meeting', async () => {
    const detail = page('[id].vue', true)
    await detail.requestMeetingAction('cancel')
    expect(detail.pendingMeetingAction.value).toEqual({ action: 'cancel' })
    expect(detail.mutateAsync).not.toHaveBeenCalled()
    await detail.confirmMeetingAction()
    expect(detail.mutateAsync).toHaveBeenCalledWith({ id: 7, action: 'cancel', body: undefined })
  })

  it('requires explicit confirmation before cancelling a resolution', async () => {
    const detail = page('[id].vue', true)
    await detail.requestResolutionAction(9, 'cancel')
    expect(detail.pendingResolutionAction.value).toEqual({ resolutionId: 9, action: 'cancel' })
    expect(detail.resolutionMutation).not.toHaveBeenCalled()
    await detail.confirmResolutionAction()
    expect(detail.resolutionMutation).toHaveBeenCalledWith({ meetingId: 7, resolutionId: 9, action: 'cancel' })
  })

  it('allows reopening a resolution only when its server action permission is present', async () => {
    const detail = page('[id].vue', true)
    await detail.requestResolutionAction(9, 'reopen')
    expect(detail.resolutionMutation).not.toHaveBeenCalled()

    detail.meeting.value.resolutions[0].can_edit_decision = true
    detail.meeting.value.resolutions[0].allowed_actions = ['reopen']
    await detail.requestResolutionAction(9, 'reopen')
    expect(detail.resolutionMutation).toHaveBeenCalledWith({ meetingId: 7, resolutionId: 9, action: 'reopen' })
  })

  it('allows a series cancellation scope only after the meeting is known to belong to a series', async () => {
    const detail = page('[id].vue', true)
    detail.meeting.value.series_id = 12
    await detail.requestMeetingAction('cancel')
    expect(detail.pendingMeetingAction.value).toEqual({ action: 'cancel', scope: 'this' })
    await detail.confirmMeetingAction()
    expect(detail.mutateAsync).toHaveBeenCalledWith({ id: 7, action: 'cancel', body: { scope: 'this' } })
  })

  it('displays API UTC datetimes in local time instead of stripping the timezone', () => {
    const detail = page('[id].vue')
    expect(detail.localTime('2026-09-08T06:30:00.000Z')).toBe('2026-09-08 09:30')
  })

  it('keeps series search and pagination in the API params and reports total pages', async () => {
    const list = page('series/index.vue')
    expect(list.pages.value).toBe(5)
    list.search.value = 'weekly'
    await new Promise(resolve => setTimeout(resolve, 300))
    list.offset.value = 50
    await nextTick()
    expect(list.params.value).toEqual({ q: 'weekly', limit: 25, offset: 50 })
  })
})
