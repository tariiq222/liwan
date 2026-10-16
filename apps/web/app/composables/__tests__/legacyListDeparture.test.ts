import { currentListView, listViewQuery } from '@nasq/ui/app/utils/listView'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute, useRouter, type NavigationGuardReturn, type RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { createHooks } from 'hookable'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as myTaskList from '../../utils/myTaskList'

const cases = [
  { file: 'my-tasks/index.vue', base: '/my-tasks' },
]
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
afterEach(() => vi.unstubAllGlobals())
async function mountList(testCase: typeof cases[number], guard: (to: RouteLocationNormalized) => NavigationGuardReturn | Promise<NavigationGuardReturn>) {
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' })
  const filename = resolve(import.meta.dirname, '../../pages', testCase.file)
  const source = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'legacy-list-departure' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const hooks = createHooks<{ 'nasq:navigation:start': (to: RouteLocationNormalized) => void }>()
  const nuxt = { hook: hooks.hook, callHook: (to: RouteLocationNormalized) => Promise.resolve().then(() => hooks.callHook('nasq:navigation:start', to)) }
  const bindings = {
    ...myTaskList, currentListView, listViewQuery, useRowNavigation: () => {}, _defineComponent: Vue.defineComponent, h: Vue.h, ref: Vue.ref, shallowRef: Vue.shallowRef, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch,
    onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount, onScopeDispose: Vue.onScopeDispose, useRoute, useRouter, refDebounced,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useAccess: () => ({ can: () => true }), useNuxtApp: () => nuxt,
    useMyTaskList: () => ({ data: Vue.ref({ items: [], total: 0 }), isFetching: Vue.ref(false), error: Vue.ref(null) }),
    FilterBar: {}, MyTaskRow: {}, sectionTabsUi: {},
  }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  let state: any
  const List = Vue.defineComponent({ setup(props, context) {
    state = page.setup(props, { ...context, expose: () => {} })
    return () => Vue.h('div')
  } })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: testCase.base, component: List },
    { path: `${testCase.base}/:record`, component: { render: () => Vue.h('div') } },
  ] })
  router.onError(() => {})
  const node = () => ({ children: [] as any[], parent: null as any })
  const renderer = Vue.createRenderer<any, any>({ patchProp() {}, insert(child, parent) { child.parent = parent; parent.children.push(child) }, remove() {}, createElement: node, createText: node, createComment: node, setText() {}, setElementText() {}, parentNode: n => n.parent, nextSibling: () => null })
  await router.push(`${testCase.base}#ledger`)
  const app = renderer.createApp({ render: () => Vue.h(RouterView) })
  app.use(router); app.mount(node()); await Vue.nextTick()
  const attempts: RouteLocationNormalized[] = []
  router.beforeEach(async to => { attempts.push(to); await nuxt.callHook(to); return guard(to) })
  return { router, state, app, attempts, hooks }
}

function renderedOpen(testCase: typeof cases[number], state: any) {
  const filename = resolve(import.meta.dirname, '../../pages', testCase.file)
  const template = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.template!.content
  const slot = /<template #name-cell[^>]*>([\s\S]*?)<\/template>/.exec(template)![1]!
  const personal = testCase.base === '/my-tasks'
  const task = personal ? { source: 'personal', id: 51 } : { id: 51 }
  const markup = personal ? slot.replace(/MyTaskRow/g, 'div') : slot.replace(/NuxtLink/g, 'a')
  const compiled = compileTemplate({ source: markup, filename, id: 'legacy-list-title-error', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const code = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const node = new Function('Vue', code)(Vue)(Vue.proxyRefs({ ...state, row: { original: task } }), []) as Vue.VNode
  return personal ? (event: MouseEvent) => node.props!.onOpen(event, task) : node.props!.onClickCapture ?? node.props!.onClick
}

function mountRealTitle(testCase: typeof cases[number], view: Awaited<ReturnType<typeof mountList>>) {
  const personal = testCase.base === '/my-tasks'
  const task = personal ? { source: 'personal', id: 51, state: 'open', assignees: [], date_deadline: null, name: 'Task' } : { id: 51 }
  let context: Record<string, unknown>
  let filename: string
  let template: string
  let stopRow = () => {}
  if (personal) {
    filename = resolve(import.meta.dirname, '../../components/personal-tasks/MyTaskRow.vue')
    const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
    const script = compileScript(descriptor, { id: 'real-my-task-title' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
    const bindings = { _defineComponent: Vue.defineComponent, computed: Vue.computed, useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar') }), deadlineDay: myTaskList.deadlineDay, isOverdue: myTaskList.isOverdue, formatCalendarDate: () => '' }
    const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
    const row = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
    const props = { task, to: view.state.rowTo(task), part: 'name', today: null }
    const scope = Vue.effectScope()
    stopRow = () => scope.stop()
    context = { ...props, ...scope.run(() => row.setup(props, { expose() {}, emit(_name: string, event: MouseEvent, item: any) { view.state.openLiveTask(event, item) } })) }
    template = descriptor.template!.content
  } else {
    filename = resolve(import.meta.dirname, '../../pages', testCase.file)
    const content = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.template!.content
    template = /<template #name-cell[^>]*>([\s\S]*?)<\/template>/.exec(content)![1]!
    context = { ...view.state, row: { original: task } }
  }
  const markup = /<NuxtLink\b[\s\S]*?<\/NuxtLink>/.exec(template)![0].replace(/NuxtLink/g, 'RouterLink')
  const compiled = compileTemplate({ source: markup, filename, id: 'actual-router-link-title', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const code = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const render = new Function('Vue', code)(Vue)
  const node = (type = '') => ({ type, props: {} as Record<string, any>, children: [] as any[], parent: null as any })
  const renderer = Vue.createRenderer<any, any>({ patchProp(n, key, _old, value) { n.props[key] = value }, insert(child, parent) { child.parent = parent; parent.children.push(child) }, remove() {}, createElement: node, createText: () => node(), createComment: () => node(), setText() {}, setElementText() {}, parentNode: n => n.parent, nextSibling: () => null })
  const root = node()
  const app = renderer.createApp({ render: () => render(Vue.proxyRefs(context), []) })
  app.use(view.router); app.mount(root)
  const anchor = root.children.find(n => n.type === 'a')!
  const snapshot = { ...anchor.props }
  const call = (handler: any, event: any) => { for (const callback of (Array.isArray(handler) ? handler : handler ? [handler] : [])) callback(event) }
  return { click(keys = {}) {
    const event = { button: 0, defaultPrevented: false, ...keys, preventDefault() { this.defaultPrevented = true } }
    call(snapshot.onClickCapture, event); call(snapshot.onClick, event)
    return event
  }, close: () => { app.unmount(); stopRow() } }
}

// Removing the navigation pause reproduces the original failure: the 250ms replace cancels a 400ms record departure.
describe.each(cases)('$base pending list writes', testCase => {
  it('real RouterLink title capture starts one live target before re-render', async () => {
    const view = await mountList(testCase, async to => { if (to.path.endsWith('/51')) await sleep(400) })
    const link = mountRealTitle(testCase, view)
    const pushes = vi.spyOn(view.router, 'push')
    try {
      view.state.search.value = 'instant'
      link.click()
      await expect.poll(() => view.router.currentRoute.value.path).toBe(`${testCase.base}/51`)
      const origin = testCase.base === '/my-tasks' ? view.router.resolve(String(view.router.currentRoute.value.query.returnTo)) : view.router.currentRoute.value
      expect(origin.query.q).toBe('instant')
      expect(pushes).toHaveBeenCalledTimes(1)
    } finally { link.close(); view.app.unmount() }
  })
  it('real RouterLink does not override an already handled title click', async () => {
    const view = await mountList(testCase, () => undefined)
    const link = mountRealTitle(testCase, view)
    const pushes = vi.spyOn(view.router, 'push')
    try {
      link.click({ defaultPrevented: true })
      expect(pushes).not.toHaveBeenCalled()
      expect(view.attempts).toHaveLength(0)
    } finally { link.close(); view.app.unmount() }
  })
  it('consumes rejected title navigation and recovers search and later edits', async () => {
    const rejected: unknown[] = []
    const onUnhandled = (error: unknown) => { rejected.push(error) }
    process.on('unhandledRejection', onUnhandled)
    const view = await mountList(testCase, async to => {
      if (to.path.endsWith('/51')) { await sleep(100); throw new Error('identity unavailable') }
    })
    try {
      const open = renderedOpen(testCase, view.state)
      view.state.search.value = 'instant'
      open({ button: 0, preventDefault() {} })
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('instant')
      expect(view.router.currentRoute.value.path).toBe(testCase.base)
      expect(view.state.search.value).toBe('instant')
      expect(rejected).toHaveLength(0)
      view.state.search.value = 'later edit'
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('later edit')
    } finally { process.off('unhandledRejection', onUnhandled); view.app.unmount() }
  })
  it('does not let a typed search cancel a record departure behind slow authorization', async () => {
    const view = await mountList(testCase, async to => { if (to.path.endsWith('/51')) await sleep(400) })
    try {
      view.state.search.value = 'review'
      const target = testCase.base === '/my-tasks' ? view.state.rowTo({ source: 'personal', id: 51 }) : view.state.itemTo({ id: 51 })
      await view.router.push(target)
      await sleep(50)
      expect(view.router.currentRoute.value.path).toBe(`${testCase.base}/51`)
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it('keeps create navigation ahead of the pending search', async () => {
    const view = await mountList(testCase, async to => { if (to.path.endsWith('/new')) await sleep(400) })
    try {
      view.state.search.value = 'review'
      await view.router.push(view.state.createTo.value)
      expect(view.router.currentRoute.value.path).toBe(`${testCase.base}/new`)
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it.each(['abort', 'throw'])('recovers the paused search once after a record guard %s', async failure => {
    const view = await mountList(testCase, async to => {
      if (to.path.endsWith('/51')) {
        await sleep(400)
        if (failure === 'throw') throw new Error('authorization unavailable')
        return false
      }
    })
    try {
      view.state.search.value = 'review'
      await view.router.push(`${testCase.base}/51`).catch(() => undefined)
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('review')
      await sleep(300)
      expect(view.router.currentRoute.value.path).toBe(testCase.base)
      expect(view.router.currentRoute.value.hash).toBe('#ledger')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(1)
    } finally { view.app.unmount() }
  })
  it('ignores a stale cancellation while the latest same-list navigation is authorizing', async () => {
    const view = await mountList(testCase, async to => { await sleep(to.path.endsWith('/51') ? 400 : 500) })
    try {
      view.state.search.value = 'old draft'
      const first = view.router.push(`${testCase.base}/51`)
      await sleep(50)
      const latest = view.router.push(`${testCase.base}?q=latest#new`)
      await Promise.all([first, latest])
      await sleep(300)
      expect(view.router.currentRoute.value.fullPath).toBe(`${testCase.base}?q=latest#new`)
      expect(view.state.search.value).toBe('latest')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(1)
    } finally { view.app.unmount() }
  })
  it('does not release a newer record attempt when an identical earlier target is cancelled', async () => {
    let records = 0
    const view = await mountList(testCase, async to => { if (to.path.endsWith('/51')) await sleep(++records === 1 ? 400 : 650) })
    try {
      view.state.search.value = 'review'
      const first = view.router.push(`${testCase.base}/51`)
      await sleep(50)
      const latest = view.router.push(`${testCase.base}/51`)
      await Promise.all([first, latest])
      expect(view.router.currentRoute.value.path).toBe(`${testCase.base}/51`)
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it('does not automatically retry a failed own query write and remains navigable', async () => {
    const view = await mountList(testCase, to => to.path === testCase.base ? false : undefined)
    try {
      view.state.search.value = 'review'
      await sleep(600)
      expect(view.attempts).toHaveLength(1)
      expect(view.router.currentRoute.value.fullPath).toBe(`${testCase.base}#ledger`)
      await view.router.push(`${testCase.base}/51`)
      expect(view.router.currentRoute.value.path).toBe(`${testCase.base}/51`)
    } finally { view.app.unmount() }
  })
  it('carries an in-flight search when an explicit filter or page change supersedes it', async () => {
    const view = await mountList(testCase, async () => { await sleep(400) })
    try {
      view.state.search.value = 'review'
      await sleep(300)
      expect(view.attempts).toHaveLength(1)
      if (testCase.base === '/my-tasks') view.state.update({ scope: 'assigned' })
      else view.state.goPage(50)
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('review')
      if (testCase.base === '/my-tasks') expect(view.router.currentRoute.value.query.scope).toBe('assigned')
      else expect(view.router.currentRoute.value.query.offset).toBe('50')
      expect(view.state.search.value).toBe('review')
      expect(view.router.currentRoute.value.hash).toBe('#ledger')
      expect(view.attempts).toHaveLength(2)
    } finally { view.app.unmount() }
  })
  it('keeps later typing when a cancelled own write settles before its explicit replacement', async () => {
    const view = await mountList(testCase, async () => { await sleep(400) })
    try {
      view.state.search.value = 'first'
      await sleep(300)
      if (testCase.base === '/my-tasks') view.state.update({ sort: 'name' })
      else view.state.goPage(50)
      view.state.search.value = 'latest'
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('latest')
      expect(view.state.search.value).toBe('latest')
      if (testCase.base === '/my-tasks') expect(view.router.currentRoute.value.query.sort).toBe('name')
      else expect(view.router.currentRoute.value.query.offset).toBeUndefined()
      expect(view.attempts).toHaveLength(3)
    } finally { view.app.unmount() }
  })
  it('does not resume a paused write after its component scope is disposed', async () => {
    const view = await mountList(testCase, async () => { await sleep(400); return false })
    try {
      view.state.search.value = 'review'
      const departure = view.router.push(`${testCase.base}/51`)
      await sleep(300)
      view.app.unmount()
      await departure
      await sleep(300)
      // Vue Router resets its current route when its only app unmounts; the relevant contract is no resumed list write.
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
      expect(view.attempts).toHaveLength(1)
    } finally { view.app.unmount() }
  })
  it('honors an authorization redirect back to the list instead of restoring the stale search', async () => {
    const view = await mountList(testCase, async to => {
      if (to.path.endsWith('/51')) {
        await sleep(400)
        return { path: testCase.base, query: { q: 'redirected' }, hash: '#redirect' }
      }
    })
    try {
      view.state.search.value = 'stale draft'
      await view.router.push(`${testCase.base}/51`)
      await sleep(300)
      expect(view.router.currentRoute.value.fullPath).toBe(`${testCase.base}?q=redirected#redirect`)
      expect(view.state.search.value).toBe('redirected')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(1)
    } finally { view.app.unmount() }
  })
  it('preserves hash and unrelated context in a successful search write', async () => {
    const view = await mountList(testCase, () => undefined)
    try {
      await view.router.push(`${testCase.base}?context=keep&offset=50#ledger`)
      view.state.search.value = 'review'
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('review')
      expect(view.router.currentRoute.value.hash).toBe('#ledger')
      expect(view.router.currentRoute.value.query.context).toBe('keep')
      expect(view.state.rowTo({ source: 'personal', id: 51 }).query.returnTo).toContain('#ledger')
    } finally { view.app.unmount() }
  })
})
