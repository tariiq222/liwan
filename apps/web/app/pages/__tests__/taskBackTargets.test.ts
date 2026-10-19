import * as recordNavigation from './helpers/recordNavigation'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, type RouteLocationRaw, type Router } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../../../')
const read = (rel: string) => readFileSync(resolve(webRoot, rel), 'utf8')

// Evaluate a page's real <script setup> against a real router, so the round trip
// is proven at runtime rather than read off the source.
function loadSetupState(rel: string, router: Router, extraBindings: Record<string, unknown> = {}) {
  const file = resolve(webRoot, rel)
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const compiled = compileScript(descriptor, { id: 'back-targets', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const bindings: Record<string, unknown> = {
    ...recordNavigation,
    _defineComponent: Vue.defineComponent,
    defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, shallowRef: Vue.shallowRef,
    onMounted: () => undefined, onBeforeUnmount: () => undefined,
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (k: string) => k }),
    useHydrated: () => Vue.ref(true), useKpiVisibility: () => ({ shown: Vue.ref(true) }),
    useAccess: () => ({ can: () => true }),
    useTaskFilters: () => Vue.ref({}),
    usePageHeader: () => undefined,
    useToast: () => ({ add: () => undefined }),
    projectIdFromPath: (path: string) => Number(path.match(/^\/projects\/(\d+)/)?.[1] ?? 0) || null,
    projectTaskParams: () => ({}), projectTaskQuery: () => ({}),
    useProject: () => ({ data: Vue.ref(undefined), error: Vue.ref(null), refetch: () => undefined }),
    ApiError: class ApiError extends Error {},
    returnToQuery: (value: string) => ({ returnTo: value }),
    safeReturnTo: (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback),
    StakeholderForm: {}, RegisterForm: {}, TaskCreateForm: {}, TaskDetailPage: {}, ProjectTaskScheduleSection: {}, TaskBoard: {}, TaskArchivedList: {}, TaskTable: {}, TaskToolbar: {}, TaskKpiStrip: {},
    ...extraBindings,
  }
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  return component.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, unknown>
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tasks', component: { template: '<div/>' } },
      { path: '/tasks/:id', component: { template: '<div/>' } },
      { path: '/projects', component: { template: '<div/>' } },
      { path: '/projects/:id', component: { template: '<div/>' } },
      { path: '/projects/:id/raci', component: { template: '<div/>' } },
      { path: '/projects/:id/tasks', component: { template: '<div/>' } },
      { path: '/projects/:id/tasks/:taskId', component: { template: '<div/>' } },
    ],
  })
}

async function backTargetAfter(router: Router, detailUrl: RouteLocationRaw, detailPage: string) {
  await router.push(detailUrl)
  await router.isReady()
  const state = loadSetupState(detailPage, router)
  return router.resolve(Vue.unref(state.backTo as Vue.Ref<RouteLocationRaw>))
}

describe('task detail back targets — runtime round trip', () => {
  it('opens a newly created project task with the filtered source as its return destination', async () => {
    const router = makeRouter()
    await router.push('/projects/7/tasks/new?q=review&view=board')
    const state = loadSetupState('app/pages/projects/[id]/tasks/new.vue', router)
    ;(state.created as (id: number) => void)(55)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/projects/7/tasks/55'))
    expect(router.currentRoute.value.query.returnTo).toBe('/projects/7/tasks?q=review&view=board')
  })

  it('returns a project task to its own list carrying q, not the project summary', async () => {
    // The parked defect: /projects/7/tasks/99?q=عقد used to fall back to
    // /projects/7?tab=tasks and drop q. The target is literal now.
    const router = makeRouter()
    const back = await backTargetAfter(router, '/projects/7/tasks/99?q=%D8%B9%D9%82%D8%AF', 'app/pages/projects/[id]/tasks/[taskId].vue')
    expect(back.path).toBe('/projects/7/tasks')
    expect(back.query.q).toBe('عقد')
    expect(back.fullPath).toBe('/projects/7/tasks?q=%D8%B9%D9%82%D8%AF')
  })

  it('returns a standalone task opened from the board back to the board', async () => {
    // Round trip through the list's own link builder: whatever it puts on the
    // detail URL is what the detail page has to send back.
    const router = makeRouter()
    await router.push('/tasks?view=board')
    await router.isReady()
    const list = loadSetupState('app/pages/tasks.vue', router)
    const to = (list.taskTo as (id: number) => RouteLocationRaw)(5)

    const detail = router.resolve(to)
    expect(detail.path).toBe('/tasks/5')
    expect(detail.query.returnTo, 'no returnTo may ride on a detail URL').toBeUndefined()

    const back = await backTargetAfter(router, detail.fullPath, 'app/pages/tasks/[id].vue')
    expect(back.path).toBe('/tasks')
    expect(back.query.view, 'the board view must survive the round trip').toBe('board')
    expect(back.query.returnTo).toBeUndefined()
  })

  it('returns a project task opened from the board back to the board', async () => {
    const router = makeRouter()
    await router.push('/projects/7/tasks?view=board&q=a')
    await router.isReady()
    const list = loadSetupState('app/pages/projects/[id]/tasks.vue', router)
    const to = (list.taskTo as (id: number) => RouteLocationRaw)(99)

    const detail = router.resolve(to)
    expect(detail.path).toBe('/projects/7/tasks/99')
    expect(detail.query.returnTo).toBeUndefined()

    const back = await backTargetAfter(router, detail.fullPath, 'app/pages/projects/[id]/tasks/[taskId].vue')
    expect(back.path).toBe('/projects/7/tasks')
    expect(back.query.view, 'the board view must survive the round trip').toBe('board')
    expect(back.query.q).toBe('a')
    expect(back.query.returnTo).toBeUndefined()
  })

  it('never lets a referrer returnTo ride onto the list URL or nest', async () => {
    // /projects/7/raci deep-links a task. If backTo copied returnTo through, the
    // list's "back to projects" button would point at RACI, and every further
    // round trip would nest the param one level deeper.
    const router = makeRouter()
    const back = await backTargetAfter(router, '/projects/7/tasks/99?returnTo=%2Fprojects%2F7%2Fraci&q=a', 'app/pages/projects/[id]/tasks/[taskId].vue')
    expect(back.fullPath).toBe('/projects/7/raci')
    expect(back.query.returnTo).toBeUndefined()

    const standalone = await backTargetAfter(router, '/tasks/5?returnTo=%2Ftasks%3Fview%3Dboard&view=board', 'app/pages/tasks/[id].vue')
    expect(standalone.fullPath).toBe('/tasks?view=board')
    expect(standalone.query.returnTo).toBeUndefined()
  })
})


describe('section creation outcomes', () => {
  it.each(['stakeholders', 'register'])('opens the newly created %s record and retains its source list', async section => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/projects/:id/:section/new', component: {} }, { path: '/projects/:id/:section/:recordId', component: {} }, { path: '/projects/:id/:section', component: {} }] })
    const source = `/projects/7/${section}?q=review#rows`
    await router.push(source)
    await router.push({ path: `/projects/7/${section}/new`, query: { returnTo: source } })
    const state = loadSetupState(`app/pages/projects/[id]/${section}/new.vue`, router)
    ;(state.created as (item: { id: number }) => void)({ id: 55 })
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/projects/7/${section}/55`))
    expect(router.currentRoute.value.query.returnTo).toBe(source)
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(source))
  })
})
