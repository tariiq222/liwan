import * as recordNavigation from '../../utils/recordListOrigin'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, effectScope, nextTick, onScopeDispose, reactive, ref, watch } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createHooks } from 'hookable'
import { refDebounced } from '@vueuse/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meetingCreateRoute } from '../../utils/meetingRoutes'
import { clearMeetingListFilters, parseMeetingListFilters, patchMeetingListQuery } from '../../utils/meetingListFilters'
import { parseOffset } from '../../utils/routeQuery'
import { filterMeetingResolutions, resolutionActions } from '../../utils/meetingWorkspace'
import { useMeetingListQuerySync } from '../../composables/useMeetingListQuerySync'

// The resolutions tab is loaded like a page: its script setup is evaluated against stubbed composables.
const resolutionsTab = '../../components/meetings/MeetingResolutionsTab.vue'

function page(file: string, pmo = false, routeOverride: Record<string, unknown> = {}, realRouter?: Router, navigationHooks = createHooks()) {
  const source = parse(readFileSync(resolve('app/pages/meetings', file), 'utf8')).descriptor.scriptSetup!.content
  const legacyRoute = { path: '/meetings/7', fullPath: '/meetings/7', params: { id: '7' },
    ...routeOverride, query: { q: 'review', offset: '25', ...(routeOverride.query as Record<string, unknown> | undefined) } }
  const route = realRouter ? reactive({
    get path() { return realRouter.currentRoute.value.path }, get fullPath() { return realRouter.currentRoute.value.fullPath },
    get params() { return realRouter.currentRoute.value.params }, get query() { return realRouter.currentRoute.value.query }, get hash() { return realRouter.currentRoute.value.hash },
  }) : legacyRoute
  const replace = realRouter ? vi.spyOn(realRouter, 'replace') : vi.fn(async ({ query }) => { legacyRoute.query = query })
  const projects = vi.fn(() => ({ data: ref([{ id: 3, name: 'Valid project' }]) }))
  const people = vi.fn(() => ({ data: ref([{ id: 3, user_id: 3, name: 'Valid organizer' }]), isLoading: ref(false), error: ref(null), refetch: vi.fn() }))
  const seriesList = vi.fn(() => ({ data: ref({ total: 120, items: [] }), isLoading: ref(false), error: ref(null), refetch: vi.fn() }))
  const mutateAsync = vi.fn(async () => { throw new Error('backend unavailable') })
  const meetingData = ref({ id: 7, can_edit: true, can_manage: true, state: 'draft', series_id: null,
    resolutions: [{ id: 9, can_update_execution: true, can_edit_decision: false, task_id: null, state: 'open', allowed_actions: ['start', 'complete', 'cancel'] }] })
  const resolutionMutation = vi.fn(async () => undefined)
  const scope = {
    ...recordNavigation, onBeforeUnmount: () => {},
    defineProps: () => reactive({ meeting: meetingData.value, meetingId: 7 }), defineEmits: () => vi.fn(),
    useMeetingListQuerySync, onScopeDispose: realRouter ? onScopeDispose : () => {},
    useNuxtApp: () => ({ hook: navigationHooks.hook }),
 ref, computed, watch, useRoute: () => route, useRouter: () => realRouter ?? ({ replace, push: vi.fn() }),
    refDebounced,
    useI18n: () => ({ t: (key: string) => key, locale: ref('ar') }), useHydrated: () => ref(true),
    useAccess: () => ({ can: () => pmo }), useProjects: projects,
    useMeetings: () => ({ data: ref({ total: 60 }), isFetching: ref(false) }),
    useMeetingSeriesList: seriesList, usePeople: people, meetingCreateRoute,
    clearMeetingListFilters, parseMeetingListFilters, patchMeetingListQuery, parseOffset,
    useConvertResolution: () => ({ mutateAsync, isPending: ref(false) }),
    useResolutionAction: () => ({ mutateAsync: resolutionMutation }), resolutionActions, filterMeetingResolutions,
    safeReturnTo: (_: unknown, fallback: string) => fallback, ApiError: class ApiError extends Error {},
    navigateTo: vi.fn(), useToast: () => ({ add: vi.fn() }) }
  const ast = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true)
  const script = ast.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(ast)).join('\n').replaceAll('import.meta.client', 'false')
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const exposed = file === 'index.vue'
    ? '{ setPage, offset }'
    : file === resolutionsTab
      ? '{ convertResolution, projectByResolution, resolutionCanReopen, requestResolutionAction, confirmResolutionAction, pendingResolutionAction, error: () => conversionError.value }'
      : '{ search, offset, pages, params }'
  return { ...new Function(...Object.keys(scope), `${js};return ${exposed}`)(...Object.values(scope)), route, meeting: meetingData, projects, seriesList, replace, resolutionMutation }
}

const listScopes: Array<() => void> = []
afterEach(() => { listScopes.splice(0).forEach(stop => stop()) })
async function listPage(file: 'index.vue' | 'series.vue') {
  const path = file === 'index.vue' ? '/meetings' : '/meetings/series'
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path, component: {} }] })
  await router.push(`${path}?q=review&offset=25`)
  const hooks = createHooks()
  router.beforeEach(to => hooks.callHook('nasq:navigation:start', to))
  const scope = effectScope()
  const loaded = scope.run(() => page(file, false, {}, router, hooks))!
  listScopes.push(() => scope.stop())
  return loaded
}

describe('meeting route and conversion behavior', () => {
  it('removes the old offset on page one and preserves search for refresh/back', async () => {
    const list = await listPage('index.vue')
    list.setPage(1)
    await expect.poll(() => list.route.query.offset).toBeUndefined()
    expect(list.route.query.q).toBe('review')
    expect(list.offset.value).toBe(0)
  })
  it('does not enable project lookup for a meetings-only editor', () => {
    const detail = page(resolutionsTab)
    expect(detail.projects.mock.calls[0]?.[0]?.value).toBe(false)
  })
  it('shows a localized inline conversion failure', async () => {
    const detail = page(resolutionsTab, true)
    detail.projectByResolution.value[9] = 3
    await expect(detail.convertResolution(9)).resolves.toBeUndefined()
    expect(detail.error()).toBe('meetingsUi.convertError')
  })

  it('requires explicit confirmation before cancelling a resolution', async () => {
    const detail = page(resolutionsTab, true)
    await detail.requestResolutionAction(9, 'cancel')
    expect(detail.pendingResolutionAction.value).toEqual({ resolutionId: 9, action: 'cancel' })
    expect(detail.resolutionMutation).not.toHaveBeenCalled()
    await detail.confirmResolutionAction()
    expect(detail.resolutionMutation).toHaveBeenCalledWith({ meetingId: 7, resolutionId: 9, action: 'cancel' })
  })

  it('allows reopening a resolution only when its server action permission is present', async () => {
    const detail = page(resolutionsTab, true)
    await detail.requestResolutionAction(9, 'reopen')
    expect(detail.resolutionMutation).not.toHaveBeenCalled()

    detail.meeting.value.resolutions[0].can_edit_decision = true
    detail.meeting.value.resolutions[0].allowed_actions = ['reopen']
    await detail.requestResolutionAction(9, 'reopen')
    expect(detail.resolutionMutation).toHaveBeenCalledWith({ meetingId: 7, resolutionId: 9, action: 'reopen' })
  })

  it('keeps series search and pagination in the API params and reports total pages', async () => {
    const list = await listPage('series.vue')
    expect(list.pages.value).toBe(5)
    list.search.value = 'weekly'
    await new Promise(resolve => setTimeout(resolve, 300))
    list.offset.value = 50
    await nextTick()
    expect(list.params.value).toEqual({ q: 'weekly', limit: 25, offset: 50 })
  })
})
