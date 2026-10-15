import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute, useRouter, type RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { createHooks } from 'hookable'
import { PROJECT_STATUSES } from '@nasq/contracts'
import { expect, it } from 'vitest'
import { parseReportStatus } from '../../utils/projectFinance'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function gate() {
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  return { release, started, async hold() { entered(); return pending } }
}
async function mountDashboard(auth: (to: RouteLocationNormalized) => unknown | Promise<unknown>) {
  const hooks = createHooks<{ 'nasq:navigation:start': (to: RouteLocationNormalized) => void }>()
  const filename = new URL('../projects/dashboard.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'dashboard-departure' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const bindings = {
    _defineComponent: Vue.defineComponent, defineComponent: Vue.defineComponent,
    ref: Vue.ref, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch, onScopeDispose: Vue.onScopeDispose,
    useRoute, useRouter, refDebounced, parseReportStatus, PROJECT_STATUSES,
    useNuxtApp: () => ({ hook: hooks.hook.bind(hooks) }),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useProjectDashboardAnalytics: () => ({ data: Vue.ref({ projects: [], recent_projects: [] }), isLoading: Vue.ref(false), error: Vue.ref(null) }),
    FilterBar: {}, ProjectDashboardCharts: {}, ProjectDashboardMetrics: {}, ProjectDashboardRecentProjects: {}, PendingCharterReviews: {},
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  let state: any
  const Dashboard = Vue.defineComponent({ setup(props, ctx) {
    state = page.setup(props, { ...ctx, expose: () => {} })
    return () => Vue.h('div')
  } })
  const Blank = Vue.defineComponent({ render: () => Vue.h('div') })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/projects/dashboard', component: Dashboard },
    { path: '/projects/:id', component: Blank }, { path: '/tasks', component: Blank },
  ] })
  const node = () => ({ children: [] as any[], parent: null as any })
  const renderer = Vue.createRenderer<any, any>({
    patchProp() {}, insert(child, parent) { child.parent = parent; parent.children.push(child) },
    remove(child) { if (child.parent) child.parent.children = child.parent.children.filter((n: any) => n !== child) },
    createElement: node, createText: node, createComment: node, setText() {}, setElementText() {},
    parentNode: n => n.parent, nextSibling: () => null,
  })
  await router.push('/projects/dashboard#recent')
  const app = renderer.createApp({ render: () => Vue.h(RouterView) })
  app.use(router); app.mount(node()); await Vue.nextTick()
  const started: RouteLocationNormalized[] = []
  router.beforeEach(async to => {
    started.push(to)
    // Actual auth publishes the exact router target before awaiting identity readiness/refresh.
    await hooks.callHook('nasq:navigation:start', to)
    return await auth(to) as any
  })
  return { router, state, started, close: () => app.unmount() }
}

it('typing then opening a project survives a 400ms identity refresh without a dashboard replacement', async () => {
  const view = await mountDashboard(to => to.path === '/projects/2' ? wait(400) : undefined)
  try {
    view.state.search.value = 'متابعة'
    await view.router.push('/projects/2?returnTo=%2Fprojects%2Fdashboard%23recent')
    await wait(300)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/2?returnTo=%2Fprojects%2Fdashboard%23recent')
    expect(view.started.filter(to => to.path === '/projects/dashboard')).toHaveLength(0)
  } finally { view.close() }
})

it.each(['abort', 'error'])('a current departure %s resumes search writes and retains its hash', async mode => {
  const view = await mountDashboard(async to => {
    if (to.path === '/projects/2') { await wait(400); if (mode === 'error') throw new Error('identity unavailable'); return false }
  })
  try {
    view.state.search.value = 'متابعة'
    const departure = view.router.push('/projects/2')
    if (mode === 'error') await expect(departure).rejects.toThrow('identity unavailable')
    else await departure
    await wait(100)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/dashboard?q=%D9%85%D8%AA%D8%A7%D8%A8%D8%B9%D8%A9#recent')
    expect(view.state.search.value).toBe('متابعة')
  } finally { view.close() }
})

it('an older cancelled departure cannot resume writes during a newer departure', async () => {
  const first = gate(), next = gate()
  const view = await mountDashboard(to => to.path === '/projects/2' ? first.hold() : to.path === '/tasks' ? next.hold() : undefined)
  try {
    view.state.search.value = 'متابعة'
    const older = view.router.push('/projects/2'); await first.started
    const newer = view.router.push('/tasks?state=open'); await next.started
    first.release(); await older; await wait(300)
    next.release(); await newer
    expect(view.router.currentRoute.value.fullPath).toBe('/tasks?state=open')
    expect(view.started.filter(to => to.path === '/projects/dashboard')).toHaveLength(0)
  } finally { first.release(); next.release(); view.close() }
})

it('an older cancelled departure cannot resume writes during a newer dashboard navigation', async () => {
  const first = gate(), next = gate()
  const view = await mountDashboard(to => to.path === '/projects/2' ? first.hold() : to.query.q === 'external' ? next.hold() : undefined)
  try {
    view.state.search.value = 'draft'
    const older = view.router.push('/projects/2'); await first.started
    const newer = view.router.push('/projects/dashboard?q=external&status=done#external'); await next.started
    first.release(); await older; await wait(300)
    next.release(); await newer; await Vue.nextTick(); await wait(20)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/dashboard?q=external&status=done#external')
    expect(view.state.search.value).toBe('external')
  } finally { first.release(); next.release(); view.close() }
})

it.each(['abort', 'error'])('a failed own query %s has one attempt and a later edit retries', async mode => {
  let fail = true, attempts = 0
  const view = await mountDashboard(async to => {
    if (to.path === '/projects/dashboard' && to.query.q) {
      attempts++; await wait(10)
      if (fail) { if (mode === 'error') throw new Error('identity unavailable'); return false }
    }
  })
  try {
    view.state.search.value = 'first'; await wait(450)
    expect(attempts).toBe(1)
    expect(view.router.currentRoute.value.query.q).toBeUndefined()
    expect(view.state.search.value).toBe('first')
    fail = false; view.state.search.value = 'latest'; await wait(350)
    expect(attempts).toBe(2)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/dashboard?q=latest#recent')
  } finally { fail = false; view.close() }
})

it('a winning external dashboard reconciles after an older own query cancellation', async () => {
  const first = gate()
  const view = await mountDashboard(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    await view.router.push('/projects/dashboard?q=external&status=done#external')
    first.release(); await wait(100)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/dashboard?q=external&status=done#external')
    expect(view.state.search.value).toBe('external')
    expect(view.state.filters.status).toBe('done')
  } finally { first.release(); view.close() }
})

it('a successful own write keeps later typing queued during authorization', async () => {
  const first = gate()
  const view = await mountDashboard(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    view.state.search.value = 'latest'; await wait(300)
    first.release(); await wait(100)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/dashboard?q=latest#recent')
    expect(view.state.search.value).toBe('latest')
  } finally { first.release(); view.close() }
})

it('an old own query cannot write dashboard filters onto the winning other page', async () => {
  const first = gate()
  const view = await mountDashboard(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    view.state.search.value = 'latest'; await wait(300)
    await view.router.push('/tasks?state=open#tasks')
    first.release(); await wait(100)
    expect(view.router.currentRoute.value.fullPath).toBe('/tasks?state=open#tasks')
    expect(view.started.filter(to => to.path === '/tasks')).toHaveLength(1)
  } finally { first.release(); view.close() }
})

it.each([false, true])('an older own cancellation cannot overwrite typing after a winning external list (filter edit=%s)', async explicitFilter => {
  const first = gate()
  const view = await mountDashboard(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    await view.router.push('/projects/dashboard?q=external&status=done#external')
    view.state.search.value = 'new human input'
    if (explicitFilter) view.state.onStatusChange('off_track')
    first.release(); await wait(30)
    expect(view.state.search.value).toBe('new human input')
    await wait(300)
    expect(view.router.currentRoute.value.query.q).toBe('new human input')
    expect(view.router.currentRoute.value.query.status).toBe(explicitFilter ? 'off_track' : 'done')
    expect(view.router.currentRoute.value.hash).toBe('#external')
  } finally { first.release(); view.close() }
})

it('an identical external target has its own identity and cannot let older cancellation overwrite typing', async () => {
  const first = gate()
  let attempts = 0
  const view = await mountDashboard(to => to.query.q === 'first' && ++attempts === 1 ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    await view.router.push('/projects/dashboard?q=first#recent')
    view.state.search.value = 'new human input'
    first.release(); await wait(30)
    expect(view.state.search.value).toBe('new human input')
    await wait(300)
    expect(view.router.currentRoute.value.query.q).toBe('new human input')
    expect(view.router.currentRoute.value.hash).toBe('#recent')
  } finally { first.release(); view.close() }
})
