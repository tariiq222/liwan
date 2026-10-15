import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute, useRouter, type NavigationGuardReturn, type RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { createHooks } from 'hookable'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as hrSearch from '../useHrSearch'
import { layerFile } from '@nasq/ui/test/helpers/layerFile'
import { returnToQuery } from '../../utils/safeReturnTo'

const testCase = { file: 'hr/documents.vue', base: '/hr/documents' }
const document = { id: 51, name: 'Policy', body: '', attachment_ids: [], department: { id: 4, name: 'Department' } }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
afterEach(() => vi.unstubAllGlobals())
// Compile the immutable SFC once; every mount still creates fresh bindings, state and router.
const filename = resolve(import.meta.dirname, '../../pages', testCase.file)
const source = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'legacy-list-departure' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
const pageCode = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
async function mountList(guard: (to: RouteLocationNormalized) => NavigationGuardReturn | Promise<NavigationGuardReturn>) {
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' })
  const hooks = createHooks<{ 'nasq:navigation:start': (to: RouteLocationNormalized) => void }>()
  const nuxt = { hook: hooks.hook, callHook: (to: RouteLocationNormalized) => Promise.resolve().then(() => hooks.callHook('nasq:navigation:start', to)) }
  let documentParams!: Vue.ComputedRef
  const bindings = {
    ...hrSearch, returnToQuery, _defineComponent: Vue.defineComponent, h: Vue.h, ref: Vue.ref, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch,
    onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount, onScopeDispose: Vue.onScopeDispose, useRoute, useRouter, refDebounced,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useAccess: () => ({ can: () => true }), useNuxtApp: () => nuxt,
    useHrDocuments: (params: Vue.ComputedRef) => { documentParams = params; return { data: Vue.ref({ items: [document], total: 100 }), isFetching: Vue.ref(false) } },
    useHrDepartments: () => ({ data: Vue.ref({ items: [document.department, { id: 7, name: 'Other' }] }) }),
    FilterBar: {}, RecordNumber: {},
  }
  const page = new Function(...Object.keys(bindings), pageCode)(...Object.values(bindings))
  let state: any
  const List = Vue.defineComponent({ setup(props, context) {
    state = page.setup(props, { ...context, expose: () => {} })
    return () => Vue.h(RouterView)
  } })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: testCase.base, component: List, children: [{ path: 'new', component: { render: () => Vue.h('div') } }] },
    { path: '/hr/departments/:departmentId/documents/:documentId', component: { render: () => Vue.h('div') } },
  ] })
  router.onError(() => {})
  const node = () => ({ children: [] as any[], parent: null as any })
  const renderer = Vue.createRenderer<any, any>({ patchProp() {}, insert(child, parent) { child.parent = parent; parent.children.push(child) }, remove() {}, createElement: node, createText: node, createComment: node, setText() {}, setElementText() {}, parentNode: n => n.parent, nextSibling: () => null })
  await router.push(`${testCase.base}?department_id=4&context=keep#documents`)
  const app = renderer.createApp({ render: () => Vue.h(RouterView) })
  app.use(router); app.mount(node()); await Vue.nextTick()
  const attempts: RouteLocationNormalized[] = []
  router.beforeEach(async to => { attempts.push(to); await nuxt.callHook(to); return guard(to) })
  return { router, state, app, attempts, hooks, documentParams }
}

// Capture the actual title link before typing renders a replacement. The anchor tag removes Nuxt's
// rendering dependency only; its page-owned click expression and to expression stay unchanged.
function renderedTitle(part: 'name' | 'mobile', state: any) {
  const filename = resolve(import.meta.dirname, '../../pages', testCase.file)
  const template = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.template!.content
  const slot = new RegExp(`<template #${part === 'name' ? 'name-cell' : 'mobile-row'}[^>]*>([\\s\\S]*?)</template>`).exec(template)![1]!
  const link = /<NuxtLink\b[\s\S]*?<\/NuxtLink>/.exec(slot)![0].replace(/NuxtLink/g, 'a')
  const compiled = compileTemplate({ source: link, filename, id: 'document-title-click', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const code = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('Vue', code)(Vue)(Vue.proxyRefs({ ...state, row: part === 'name' ? { original: document } : document }), []) as Vue.VNode
}

function mountRealLink(view: Awaited<ReturnType<typeof mountList>>, part: 'name' | 'mobile' | 'create') {
  const filename = resolve(import.meta.dirname, '../../pages', testCase.file)
  const template = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.template!.content
  let markup: string
  const context: Record<string, unknown> = { ...view.state, row: part === 'name' ? { original: document } : document }
  if (part === 'create') {
    const start = /<SharedListPage\b[\s\S]*?>/.exec(template)![0].replace('SharedListPage', 'div')
    const shared = readFileSync(layerFile('app/components/shared/layout/ListPage.vue'), 'utf8')
    const button = /<UButton\b[\s\S]*?<\/UButton>/.exec(shared)![0].replace(/UButton/g, 'RouterLink')
    markup = `${start}${button}</div>`
    context.props = { createTo: view.state.createTo.value }
    context.$slots = {}
  } else {
    const slot = new RegExp(`<template #${part === 'name' ? 'name-cell' : 'mobile-row'}[^>]*>([\\s\\S]*?)</template>`).exec(template)![1]!
    markup = /<NuxtLink\b[\s\S]*?<\/NuxtLink>/.exec(slot)![0].replace(/NuxtLink/g, 'RouterLink')
  }
  const compiled = compileTemplate({ source: markup, filename, id: 'real-document-link', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const code = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const render = new Function('Vue', code)(Vue)
  const node = (type = '') => ({ type, props: {} as Record<string, any>, children: [] as any[], parent: null as any })
  const renderer = Vue.createRenderer<any, any>({ patchProp(n, key, _old, value) { n.props[key] = value }, insert(child, parent) { child.parent = parent; parent.children.push(child) }, remove() {}, createElement: node, createText: () => node(), createComment: () => node(), setText() {}, setElementText() {}, parentNode: n => n.parent, nextSibling: () => null })
  const root = node()
  const app = renderer.createApp({ render: () => render(Vue.proxyRefs(context), []) })
  app.use(view.router); app.mount(root)
  const find = (n: any): any => n.type === 'a' ? n : n.children.map(find).find(Boolean)
  const anchor = find(root)
  const snapshot = { ...anchor.props }
  const ancestors: any[] = []
  for (let n = anchor.parent; n && n !== root; n = n.parent) ancestors.unshift({ ...n.props })
  const call = (handler: any, event: any) => { for (const callback of (Array.isArray(handler) ? handler : handler ? [handler] : [])) callback(event) }
  class LinkTarget { closest(selector: string) { return selector === '[data-shortcut-create]' && part === 'create' ? this : null } }
  vi.stubGlobal('Element', LinkTarget)
  return { href: snapshot.href, click(keys = {}) {
    const event = { button: 0, defaultPrevented: false, ...keys, target: new LinkTarget(), preventDefault() { this.defaultPrevented = true } }
    for (const props of ancestors) call(props.onClickCapture, event)
    call(snapshot.onClickCapture, event)
    call(snapshot.onClick, event)
    return event
  }, close: () => app.unmount() }
}

describe('HR document list delayed departure', () => {
  it.each(['name', 'mobile', 'create'] as const)('real RouterLink %s capture starts exactly one live navigation before render', async part => {
    const view = await mountList(async to => { if (to.path.endsWith('/51') || to.path.endsWith('/new')) await sleep(400) })
    const link = mountRealLink(view, part)
    const pushes = vi.spyOn(view.router, 'push')
    try {
      view.state.search.value = 'instant'
      link.click()
      await expect.poll(() => view.router.currentRoute.value.path).toBe(part === 'create' ? '/hr/documents/new' : '/hr/departments/4/documents/51')
      const origin = part === 'create' ? view.router.currentRoute.value : view.router.resolve(String(view.router.currentRoute.value.query.returnTo))
      expect(origin.query.q).toBe('instant')
      expect(origin.hash).toBe('#documents')
      expect(pushes).toHaveBeenCalledTimes(1)
      expect(view.attempts).toHaveLength(1)
    } finally { link.close(); view.app.unmount() }
  })
  it.each(['name', 'mobile', 'create'] as const)('real RouterLink %s preserves an already handled click', async part => {
    const view = await mountList(() => undefined)
    const link = mountRealLink(view, part)
    const pushes = vi.spyOn(view.router, 'push')
    try {
      link.click({ defaultPrevented: true })
      expect(pushes).not.toHaveBeenCalled()
      expect(view.attempts).toHaveLength(0)
    } finally { link.close(); view.app.unmount() }
  })
  it.each([
    { part: 'name', detail: 1 }, { part: 'mobile', detail: 1 },
    { part: 'name', detail: 0 }, { part: 'mobile', detail: 0 },
  ] as const)('the stale rendered $part title evaluates live search on click detail=$detail', async ({ part, detail }) => {
    const view = await mountList(async to => { if (to.path.endsWith('/51')) await sleep(400) })
    try {
      const title = renderedTitle(part, view.state)
      expect(view.router.resolve(title.props!.to.query.returnTo).query.q).toBeUndefined()
      view.state.search.value = 'instant'
      const event = { button: 0, detail, preventDefault: vi.fn() }
      if (title.props!.onClickCapture || title.props!.onClick) (title.props!.onClickCapture ?? title.props!.onClick)(event)
      else void view.router.push(title.props!.to) // NuxtLink's normal navigation uses its rendered target.
      await expect.poll(() => view.router.currentRoute.value.path).toBe('/hr/departments/4/documents/51')
      const origin = view.router.resolve(String(view.router.currentRoute.value.query.returnTo))
      expect(origin.query.q).toBe('instant')
      expect(origin.hash).toBe('#documents')
      expect(origin.hash).toBe('#documents')
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it.each([
    { part: 'name', keys: { metaKey: true } }, { part: 'mobile', keys: { metaKey: true } },
    { part: 'name', keys: { ctrlKey: true } }, { part: 'mobile', keys: { ctrlKey: true } },
    { part: 'name', keys: { shiftKey: true } }, { part: 'mobile', keys: { shiftKey: true } },
    { part: 'name', keys: { altKey: true } }, { part: 'mobile', keys: { altKey: true } },
    { part: 'name', keys: { button: 1 } }, { part: 'mobile', keys: { button: 1 } },
  ] as const)('leaves modified $part title click $keys to native link handling', async ({ part, keys }) => {
    const view = await mountList(() => undefined)
    try {
      const title = renderedTitle(part, view.state)
      const event = { button: 0, ...keys, preventDefault: vi.fn() }
      ;(title.props!.onClickCapture ?? title.props!.onClick)(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(view.attempts).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it.each(['name', 'mobile'] as const)('a stale %s title consumes rejected authorization and recovers search', async part => {
    const rejected: unknown[] = []
    const onUnhandled = (error: unknown) => { rejected.push(error) }
    process.on('unhandledRejection', onUnhandled)
    const view = await mountList(async to => {
      if (to.path.endsWith('/51')) { await sleep(100); throw new Error('identity unavailable') }
    })
    try {
      const title = renderedTitle(part, view.state)
      view.state.search.value = 'instant'
      ;(title.props!.onClickCapture ?? title.props!.onClick)({ button: 0, preventDefault: vi.fn() })
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('instant')
      expect(view.router.currentRoute.value.path).toBe('/hr/documents')
      expect(view.state.search.value).toBe('instant')
      expect(rejected).toHaveLength(0)
      view.state.search.value = 'later edit'
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('later edit')
    } finally { process.off('unhandledRejection', onUnhandled); view.app.unmount() }
  })
  it('keeps a record ahead of the pending search behind 400ms authorization', async () => {
    const view = await mountList(async to => { if (to.path.endsWith('/51')) await sleep(400) })
    try {
      view.state.search.value = 'review'
      await view.router.push(view.state.documentTo(document))
      expect(view.router.currentRoute.value.path).toBe('/hr/departments/4/documents/51')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it('builds record return state from live search and current hash before debounce commits', async () => {
    const view = await mountList(() => undefined)
    try {
      view.state.search.value = 'review'
      const target = view.state.documentTo(document)
      const origin = view.router.resolve(target.query.returnTo)
      expect(origin.path).toBe('/hr/documents')
      expect(origin.query.q).toBe('review')
      expect(origin.query.department_id).toBe('4')
      expect(origin.query.context).toBe('keep')
      expect(origin.hash).toBe('#documents')
    } finally { view.app.unmount() }
  })
  it('keeps the new panel ahead of debounce with live query and its department preselection', async () => {
    const view = await mountList(async to => { if (to.path.endsWith('/new')) await sleep(400) })
    try {
      view.state.search.value = 'review'
      await view.router.push(view.state.createTo.value)
      expect(view.router.currentRoute.value.path).toBe('/hr/documents/new')
      expect(view.router.currentRoute.value.query.q).toBe('review')
      expect(view.router.currentRoute.value.query.department_id).toBe('4')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
      view.state.search.value = 'later background draft'
      await sleep(300)
      expect(view.router.currentRoute.value.path).toBe('/hr/documents/new')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it.each(['abort', 'error'])('recovers a paused search once after authorization %s', async mode => {
    const view = await mountList(async to => {
      if (to.path.endsWith('/51')) {
        await sleep(400)
        if (mode === 'error') throw new Error('identity unavailable')
        return false
      }
    })
    try {
      view.state.search.value = 'review'
      await view.router.push(view.state.documentTo(document)).catch(() => undefined)
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('review')
      await sleep(300)
      expect(view.router.currentRoute.value.hash).toBe('#documents')
      expect(view.router.currentRoute.value.query.context).toBe('keep')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(1)
    } finally { view.app.unmount() }
  })
  it('ignores stale cancellation while the latest same-list target authorizes', async () => {
    const view = await mountList(async to => { await sleep(to.path.endsWith('/51') ? 400 : 500) })
    try {
      view.state.search.value = 'old draft'
      const first = view.router.push(view.state.documentTo(document))
      await sleep(50)
      const latest = view.router.push('/hr/documents?q=external&department_id=7&offset=50#external')
      await Promise.all([first, latest]); await sleep(300)
      expect(view.router.currentRoute.value.fullPath).toBe('/hr/documents?q=external&department_id=7&offset=50#external')
      expect(view.state.search.value).toBe('external')
      expect(view.state.departmentId.value).toBe(7)
      expect(view.state.offset.value).toBe(50)
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(1)
    } finally { view.app.unmount() }
  })
  it('does not release a newer identical record target when an earlier attempt cancels', async () => {
    let attempts = 0
    const view = await mountList(async to => { if (to.path.endsWith('/51')) await sleep(++attempts === 1 ? 400 : 650) })
    try {
      view.state.search.value = 'review'
      const first = view.router.push(view.state.documentTo(document))
      await sleep(50)
      const latest = view.router.push(view.state.documentTo(document))
      await Promise.all([first, latest])
      expect(view.router.currentRoute.value.path).toBe('/hr/departments/4/documents/51')
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
  it('carries live search when an explicit department filter supersedes its own pending write', async () => {
    const view = await mountList(async () => { await sleep(400) })
    try {
      view.state.search.value = 'review'; await sleep(300)
      expect(view.attempts).toHaveLength(1)
      view.state.onDepartmentChange('7'); await Vue.nextTick()
      expect(view.documentParams.value.department_id).toBe(4)
      expect(view.documentParams.value.q).toBeUndefined()
      await expect.poll(() => view.router.currentRoute.value.query.department_id).toBe('7')
      expect(view.router.currentRoute.value.query.q).toBe('review')
      expect(view.state.search.value).toBe('review')
      expect(view.router.currentRoute.value.hash).toBe('#documents')
      expect(view.attempts).toHaveLength(2)
    } finally { view.app.unmount() }
  })
  it('preserves later typing through stale own cancellation and explicit filter success', async () => {
    const view = await mountList(async () => { await sleep(400) })
    try {
      view.state.search.value = 'first'; await sleep(300)
      view.state.onDepartmentChange('7')
      view.state.search.value = 'latest'
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('latest')
      expect(view.router.currentRoute.value.query.department_id).toBe('7')
      expect(view.state.search.value).toBe('latest')
      expect(view.attempts).toHaveLength(3)
    } finally { view.app.unmount() }
  })
  it.each(['abort', 'error'])('bounds a rejected own query %s and permits a later edit', async mode => {
    let reject = true
    const view = await mountList(to => {
      if (to.path === testCase.base && reject) {
        if (mode === 'error') throw new Error('identity unavailable')
        return false
      }
    })
    try {
      view.state.search.value = 'review'; await sleep(600)
      expect(view.attempts).toHaveLength(1)
      expect(view.router.currentRoute.value.query.q).toBeUndefined()
      expect(view.state.search.value).toBe('review')
      reject = false
      view.state.search.value = 'latest'
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('latest')
      expect(view.attempts).toHaveLength(2)
    } finally { view.app.unmount() }
  })
  it('honors a current authorization redirect to the list', async () => {
    const view = await mountList(async to => {
      if (to.path.endsWith('/51')) { await sleep(400); return '/hr/documents?q=redirected&department_id=7#redirect' }
    })
    try {
      view.state.search.value = 'stale draft'
      await view.router.push(view.state.documentTo(document)); await sleep(300)
      expect(view.router.currentRoute.value.fullPath).toBe('/hr/documents?q=redirected&department_id=7#redirect')
      expect(view.state.search.value).toBe('redirected')
      expect(view.state.departmentId.value).toBe(7)
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(1)
    } finally { view.app.unmount() }
  })
  it('preserves committed context and hash through pagination and resets offset only for search', async () => {
    const view = await mountList(() => undefined)
    try {
      view.state.setPage(3)
      await expect.poll(() => view.router.currentRoute.value.query.offset).toBe('50')
      expect(view.router.currentRoute.value.hash).toBe('#documents')
      expect(view.router.currentRoute.value.query.context).toBe('keep')
      view.state.search.value = 'review'
      expect(view.router.resolve(view.state.documentTo(document).query.returnTo).query.offset).toBeUndefined()
      view.state.setPage(4)
      await expect.poll(() => view.router.currentRoute.value.query.q).toBe('review')
      expect(view.router.currentRoute.value.query.offset).toBeUndefined()
      expect(view.attempts).toHaveLength(2)
    } finally { view.app.unmount() }
  })
  it('drops a referrer from record and create origins instead of nesting it', async () => {
    const view = await mountList(() => undefined)
    try {
      await view.router.push('/hr/documents?returnTo=%2Fsettings%2Fusers&department_id=4#documents')
      view.state.search.value = 'review'
      expect(view.router.resolve(view.state.documentTo(document).query.returnTo).query.returnTo).toBeUndefined()
      expect(view.state.createTo.value.query.returnTo).toBeUndefined()
    } finally { view.app.unmount() }
  })
  it('does not resume paused search after its page scope is disposed', async () => {
    const view = await mountList(async () => { await sleep(400); return false })
    try {
      view.state.search.value = 'review'
      const departure = view.router.push(view.state.documentTo(document))
      await sleep(300); view.app.unmount()
      await departure; await sleep(300)
      expect(view.attempts).toHaveLength(1)
      expect(view.attempts.filter(to => to.path === testCase.base)).toHaveLength(0)
    } finally { view.app.unmount() }
  })
})
