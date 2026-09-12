import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, type RouteLocationRaw, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

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
    _defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, shallowRef: Vue.shallowRef,
    onMounted: () => undefined, onBeforeUnmount: () => undefined,
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (k: string) => k }),
    useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => true }),
    useTaskFilters: () => Vue.ref({}),
    usePageHeader: () => undefined,
    projectIdFromPath: (path: string) => Number(path.match(/^\/projects\/(\d+)/)?.[1] ?? 0) || null,
    projectTaskParams: () => ({}), projectTaskQuery: () => ({}),
    useProject: () => ({ data: Vue.ref(undefined), error: Vue.ref(null), refetch: () => undefined }),
    ApiError: class ApiError extends Error {},
    returnToQuery: (value: string) => ({ returnTo: value }),
    safeReturnTo: (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback),
    TaskDetailPage: {}, TaskBoard: {}, TaskTable: {}, TaskToolbar: {},
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

describe('task detail back targets — source shape', () => {
  it('names the prop back-to on the page component itself', () => {
    const component = read('app/components/task/TaskDetailPage.vue')
    expect(component).toMatch(/backTo\?: RouteLocationRaw/)
    expect(component).not.toContain('closeTo')
  })

  it('drops the returnTo chain from both detail pages', () => {
    for (const page of ['app/pages/tasks/[id].vue', 'app/pages/projects/[id]/tasks/[taskId].vue']) {
      expect(read(page), page).toContain(':back-to="backTo"')
      expect(read(page), page).not.toContain('safeReturnTo')
      expect(read(page), page).not.toContain('closeTo')
    }
  })

  it('stops deep links into a task from carrying a dead referrer', () => {
    // A returnTo on a task link ends up on the list URL, where the list's own
    // "back to projects" button would silently follow it instead.
    for (const page of ['app/pages/projects/[id]/raci.vue', 'app/pages/projects/[id]/register/[registerId].vue']) {
      const taskLinks = read(page).match(/\{ path: `\/projects\/\$\{[^}]+\}\/tasks\/\$\{[^}]+\}`[^}]*\}/g) ?? []
      expect(taskLinks.length, page).toBeGreaterThan(0)
      for (const link of taskLinks) expect(link, `${page}: ${link}`).not.toContain('returnTo')
    }
  })
})

describe('task detail back targets — runtime round trip', () => {
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
    await router.push('/tasks?tab=board')
    await router.isReady()
    // openTask navigates rather than returning a location, so record the push.
    let pushed: RouteLocationRaw | undefined
    const recorder = { ...router, currentRoute: router.currentRoute, push: (to: RouteLocationRaw) => { pushed = to; return Promise.resolve() }, replace: () => Promise.resolve() }
    const list = loadSetupState('app/pages/tasks.vue', router, { useRouter: () => recorder })
    ;(list.openTask as (id: number) => void)(5)

    const detail = router.resolve(pushed!)
    expect(detail.path).toBe('/tasks/5')
    expect(detail.query.returnTo, 'no returnTo may ride on a detail URL').toBeUndefined()

    const back = await backTargetAfter(router, detail.fullPath, 'app/pages/tasks/[id].vue')
    expect(back.path).toBe('/tasks')
    expect(back.query.tab, 'the board view must survive the round trip').toBe('board')
    expect(back.query.returnTo).toBeUndefined()
  })

  it('returns a project task opened from the board back to the board', async () => {
    const router = makeRouter()
    await router.push('/projects/7/tasks?view=board&q=a')
    await router.isReady()
    const list = loadSetupState('app/pages/projects/[id]/tasks/index.vue', router)
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
    expect(back.fullPath).toBe('/projects/7/tasks?q=a')
    expect(back.query.returnTo).toBeUndefined()

    const standalone = await backTargetAfter(router, '/tasks/5?returnTo=%2Ftasks%3Ftab%3Dboard&tab=board', 'app/pages/tasks/[id].vue')
    expect(standalone.fullPath).toBe('/tasks?tab=board')
    expect(standalone.query.returnTo).toBeUndefined()
  })
})
