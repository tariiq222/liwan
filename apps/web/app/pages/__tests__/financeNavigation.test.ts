import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, onBeforeRouteLeave, onBeforeRouteUpdate, RouterView, useRoute, useRouter, type RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { createHooks } from 'hookable'
import { expect, it } from 'vitest'
import * as finance from '../../utils/projectFinance'
import { parsePositiveId } from '../../utils/routeParams'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { rootedNode } from '../../../tests/hostNode'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function gate() {
  let release!: (value?: unknown) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const pending = new Promise(resolve => { release = resolve })
  return { release, started, async hold() { entered(); return pending } }
}

async function mountFinance(auth: (to: RouteLocationNormalized) => unknown | Promise<unknown>, deferPageRoute = false) {
  const hooks = createHooks<{ 'liwan:navigation:start': (to: RouteLocationNormalized) => void }>()
  const pageRoute = Vue.shallowRef<any>(null)
  const deferredRoute = new Proxy({}, { get: (_target, key) => pageRoute.value?.[key] })
  const filename = new URL('../projects/[id]/finance.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'finance-navigation' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const bindings = {
    ...finance, _defineComponent: Vue.defineComponent, defineComponent: Vue.defineComponent,
    ref: Vue.ref, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch, onScopeDispose: Vue.onScopeDispose,
    useRoute: deferPageRoute ? () => deferredRoute : useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate, refDebounced, parsePositiveId, returnToQuery,
    useNuxtApp: () => ({ hook: hooks.hook.bind(hooks) }),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useProject: () => ({ data: Vue.ref({ id: 2 }) }),
    useProjectFinanceList: () => ({ data: Vue.ref({ items: [], total: 4, can_manage: true }), isFetching: Vue.ref(false), error: Vue.ref(null) }),
    ApiError: class ApiError extends Error {}, FinanceEntryTable: {}, FinanceSummaryCards: {}, FinanceActualLines: {}, FilterBar: {}, SharedSegmentedControl: {},
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  let state: any
  const FinancePage = Vue.defineComponent({ setup(props, ctx) {
    state = page.setup(props, { ...ctx, expose: () => {} })
    return () => Vue.h(RouterView)
  } })
  const Blank = Vue.defineComponent({ render: () => Vue.h('div') })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/projects/:id/finance', component: FinancePage, children: [{ path: ':entryId', component: Blank }] }, { path: '/outside', component: Blank }] })
  const node = () => rootedNode({ children: [] as any[], parent: null as any })
  const renderer = Vue.createRenderer<any, any>({
    patchProp() {}, insert(child, parent) { child.parent = parent; parent.children.push(child) }, remove() {},
    createElement: node, createText: node, createComment: node, setText() {}, setElementText() {},
    parentNode: n => n.parent, nextSibling: () => null,
  })
  await router.push('/projects/2/finance#ledger')
  pageRoute.value = router.currentRoute.value
  const app = renderer.createApp({ render: () => Vue.h(RouterView) })
  app.use(router); app.mount(node()); await Vue.nextTick()
  const started: RouteLocationNormalized[] = []
  router.beforeEach(async to => {
    // The public auth middleware contract: publish the real target before its first identity await.
    started.push(to)
    await hooks.callHook('liwan:navigation:start', to)
    return await auth(to) as any
  })
  return { router, get state() { return state }, started, syncPageRoute: () => { pageRoute.value = router.currentRoute.value }, close: () => app.unmount() }
}

it('a 400ms identity refresh cannot let the search debounce cancel entry navigation or lose its return hash', async () => {
  const view = await mountFinance(to => to.path.endsWith('/51') ? wait(400) : undefined)
  try {
    view.state.search.value = 'ميزانية'
    await view.router.push(view.state.entryTo({ id: 51 }))
    expect(view.router.currentRoute.value.path).toBe('/projects/2/finance/51')
    expect(view.router.currentRoute.value.query.q).toBe('ميزانية')
    expect(view.router.currentRoute.value.query.returnTo).toBe('/projects/2/finance?q=%D9%85%D9%8A%D8%B2%D8%A7%D9%86%D9%8A%D8%A9#ledger')
  } finally { view.close() }
})

it('a cancelled older record navigation cannot resume list writes during a newer record navigation', async () => {
  const first = gate(), next = gate()
  const view = await mountFinance(to => to.path.endsWith('/51') ? first.hold() : to.path.endsWith('/52') ? next.hold() : undefined)
  try {
    view.state.search.value = 'ميزانية'
    const older = view.router.push(view.state.entryTo({ id: 51 })); await first.started
    const newer = view.router.push(view.state.entryTo({ id: 52 })); await next.started
    first.release(); await older; await wait(300)
    next.release(); await newer
    expect(view.router.currentRoute.value.path).toBe('/projects/2/finance/52')
    expect(view.router.currentRoute.value.query.q).toBe('ميزانية')
  } finally { first.release(); next.release(); view.close() }
})

it('a cancelled older record cannot cancel a newer delayed list navigation with its query write', async () => {
  const first = gate(), next = gate()
  const view = await mountFinance(to => to.path.endsWith('/51') ? first.hold() : to.query.kind === 'expense' ? next.hold() : undefined)
  try {
    view.state.search.value = 'ميزانية'
    const older = view.router.push(view.state.entryTo({ id: 51 })); await first.started
    const newer = view.router.push('/projects/2/finance?kind=expense#ledger'); await next.started
    first.release(); await older; await wait(300)
    next.release(); await newer; await Vue.nextTick(); await wait(20)
    expect(view.router.currentRoute.value.query.kind).toBe('expense')
    expect(view.router.currentRoute.value.query.q).toBeUndefined()
    expect(view.router.currentRoute.value.hash).toBe('#ledger')
  } finally { first.release(); next.release(); view.close() }
})

it('an aborted current departure resumes search writes without clearing the draft search or hash', async () => {
  const view = await mountFinance(async to => { if (to.path.endsWith('/51')) { await wait(400); return false } })
  try {
    view.state.search.value = 'ميزانية'
    await view.router.push(view.state.entryTo({ id: 51 })); await wait(100)
    expect(view.router.currentRoute.value.path).toBe('/projects/2/finance')
    expect(view.router.currentRoute.value.query.q).toBe('ميزانية')
    expect(view.router.currentRoute.value.hash).toBe('#ledger')
    expect(view.state.search.value).toBe('ميزانية')
  } finally { view.close() }
})

it('an identity error resumes list writes and a later explicit retry can open the entry', async () => {
  let fail = true
  const view = await mountFinance(async to => { if (fail && to.path.endsWith('/51')) { await wait(400); throw new Error('identity unavailable') } })
  try {
    view.state.search.value = 'ميزانية'
    await expect(view.router.push(view.state.entryTo({ id: 51 }))).rejects.toThrow('identity unavailable')
    await wait(100)
    expect(view.router.currentRoute.value.query.q).toBe('ميزانية')
    expect(view.router.currentRoute.value.hash).toBe('#ledger')
    fail = false
    await view.router.push(view.state.entryTo({ id: 51 }))
    expect(view.router.currentRoute.value.path).toBe('/projects/2/finance/51')
  } finally { view.close() }
})

it('an auth redirect tracks its actual target instead of resuming the older list writer', async () => {
  const view = await mountFinance(async to => {
    if (to.path.endsWith('/51')) { await wait(400); return { path: '/projects/2/finance/52', query: to.query } }
  })
  try {
    view.state.search.value = 'ميزانية'
    await view.router.push(view.state.entryTo({ id: 51 }))
    expect(view.router.currentRoute.value.path).toBe('/projects/2/finance/52')
    expect(view.router.currentRoute.value.query.q).toBe('ميزانية')
    expect(String(view.router.currentRoute.value.query.returnTo)).toContain('#ledger')
  } finally { view.close() }
})

it.each(['abort', 'error'])('a failed own query %s stops after one attempt and a later search edit retries', async mode => {
  let fail = true, attempts = 0
  const view = await mountFinance(async to => {
    if (to.path === '/projects/2/finance' && to.query.q) {
      attempts++
      // Keep a broken implementation observable without creating a tight endless microtask loop.
      await wait(10)
      if (fail) {
        if (mode === 'error') throw new Error('identity unavailable')
        return false
      }
    }
  })
  try {
    view.state.search.value = 'ميزانية'
    await wait(450)
    expect(attempts).toBe(1)
    expect(view.router.currentRoute.value.query.q).toBeUndefined()
    expect(view.state.search.value).toBe('ميزانية')
    fail = false
    view.state.search.value = 'متابعة'
    await wait(350)
    expect(attempts).toBe(2)
    expect(view.router.currentRoute.value.query.q).toBe('متابعة')
    expect(view.router.currentRoute.value.hash).toBe('#ledger')
  } finally { fail = false; view.close() }
})

it('a new-entry panel held by identity refresh is not replaced by a list query', async () => {
  const view = await mountFinance(to => to.path.endsWith('/new') ? wait(400) : undefined)
  try {
    view.state.search.value = 'ميزانية'
    await view.router.push(view.state.newTo('budget'))
    await wait(300)
    expect(view.router.currentRoute.value.path).toBe('/projects/2/finance/new')
    expect(String(view.router.currentRoute.value.query.returnTo)).toContain('#ledger')
    expect(view.started.filter(to => to.path === '/projects/2/finance')).toHaveLength(0)
  } finally { view.close() }
})

it('a reused finance page never writes old-project filters while its Nuxt route catches up', async () => {
  const view = await mountFinance(to => to.params.id === '3' ? wait(400) : undefined, true)
  try {
    view.state.search.value = 'ميزانية'
    await view.router.push('/projects/3/finance?q=جديد#ledger')
    await wait(300)
    expect(view.router.currentRoute.value.path).toBe('/projects/3/finance')
    expect(view.router.currentRoute.value.query.q).toBe('جديد')
    expect(view.started.filter(to => to.path === '/projects/2/finance')).toHaveLength(0)
    view.syncPageRoute(); await Vue.nextTick()
    expect(view.state.search.value).toBe('جديد')
    view.state.search.value = 'متابعة'
    await wait(750)
    expect(view.router.currentRoute.value.path).toBe('/projects/3/finance')
    expect(view.router.currentRoute.value.query.q).toBe('متابعة')
    expect(view.router.currentRoute.value.hash).toBe('#ledger')
  } finally { view.close() }
})

it('reconciles a newer external list that committed before an older own write was cancelled', async () => {
  const first = gate()
  const view = await mountFinance(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    await view.router.push('/projects/2/finance?q=external&kind=expense#external')
    first.release(); await wait(100)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/2/finance?q=external&kind=expense#external')
    expect(view.state.search.value).toBe('external')
    expect(view.state.filters.q).toBe('external')
    expect(view.state.filters.kind).toBe('expense')
  } finally { first.release(); view.close() }
})

it('a successful own write preserves later typing queued while authorization was pending', async () => {
  const first = gate()
  const view = await mountFinance(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    view.state.search.value = 'latest'; await wait(300)
    first.release(); await wait(100)
    expect(view.router.currentRoute.value.query.q).toBe('latest')
    expect(view.state.search.value).toBe('latest')
    expect(view.state.filters.q).toBe('latest')
    expect(view.router.currentRoute.value.hash).toBe('#ledger')
  } finally { first.release(); view.close() }
})

it.each([false, true])('an older own cancellation cannot overwrite typing after a winning external list (filter edit=%s)', async explicitFilter => {
  const first = gate()
  const view = await mountFinance(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    await view.router.push('/projects/2/finance?q=external&kind=expense#external')
    view.state.search.value = 'new human input'
    if (explicitFilter) view.state.onKindChange('budget')
    first.release(); await wait(30)
    expect(view.state.search.value).toBe('new human input')
    await wait(300)
    expect(view.router.currentRoute.value.query.q).toBe('new human input')
    expect(view.router.currentRoute.value.query.kind).toBe(explicitFilter ? 'budget' : 'expense')
    expect(view.router.currentRoute.value.hash).toBe('#external')
  } finally { first.release(); view.close() }
})

it('an identical external target has its own identity and cannot let older cancellation overwrite typing', async () => {
  const first = gate()
  let attempts = 0
  const view = await mountFinance(to => to.query.q === 'first' && ++attempts === 1 ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    await view.router.push('/projects/2/finance?q=first#ledger')
    view.state.search.value = 'new human input'
    first.release(); await wait(30)
    expect(view.state.search.value).toBe('new human input')
    await wait(300)
    expect(view.router.currentRoute.value.query.q).toBe('new human input')
    expect(view.router.currentRoute.value.hash).toBe('#ledger')
  } finally { first.release(); view.close() }
})

it('an unmounted finance writer cannot apply queued typing to a newly mounted list', async () => {
  const first = gate()
  const view = await mountFinance(to => to.query.q === 'first' ? first.hold() : undefined)
  try {
    const old = view.state
    old.search.value = 'first'; await first.started
    await view.router.push('/projects/2/finance?q=external&kind=expense#external')
    old.search.value = 'old uncommitted draft'; await wait(300)
    await view.router.push('/outside')
    await view.router.push('/projects/2/finance?q=current#new-list')
    expect(view.state).not.toBe(old)
    const attempts = view.started.length
    first.release(); await wait(350)
    expect(view.router.currentRoute.value.fullPath).toBe('/projects/2/finance?q=current#new-list')
    expect(view.state.search.value).toBe('current')
    expect(view.started).toHaveLength(attempts)
  } finally { first.release(); view.close() }
})
