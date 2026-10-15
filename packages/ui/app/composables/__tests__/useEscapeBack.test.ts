import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { useEventListener } from '@vueuse/core'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, nextTick, ref, type App, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import * as VueRouter from 'vue-router'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHostNode, findNode, hostRenderer, type HostNode } from '../../../test/helpers/hostRenderer'
import { useHydrated } from '../useHydrated'
import { useEscapeBack } from '../useEscapeBack'

const uiApp = resolve(import.meta.dirname, '../..')

// The composables under test reach for Nuxt's auto-imports; the real
// implementations are wired here so only the injection points are stubbed.
const globals = globalThis as Record<string, unknown>
globals.ref = Vue.ref
globals.onMounted = Vue.onMounted
globals.useEventListener = useEventListener
globals.useHydrated = useHydrated

interface FakeDocument {
  overlayOpen: boolean
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  removeEventListener: (type: string, listener: (event: unknown) => void) => void
  querySelector: (selectors: string) => unknown
  press: (event: Record<string, unknown>) => void
  listenerCount: () => number
}

function createFakeDocument(): FakeDocument {
  const listeners = new Set<(event: unknown) => void>()
  return {
    overlayOpen: false,
    addEventListener(type, listener) { if (type === 'keydown') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'keydown') listeners.delete(listener) },
    querySelector(selectors) {
      // Stands in for a reka-ui layer that is mounted in the document.
      return this.overlayOpen && selectors.includes('data-dismissable-layer') ? { tagName: 'DIV' } : null
    },
    press(event) { for (const listener of [...listeners]) listener(event) },
    listenerCount: () => listeners.size,
  }
}

let doc: FakeDocument
let router: Router
const mountedApps: App<HostNode>[] = []

const passthroughButton = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) { return () => h('button', attrs, slots.default?.()) },
})
const stubModal = defineComponent({
  props: { open: Boolean, content: Object },
  setup(props, { slots }) { return () => props.open ? h('div', props.content, slots.footer?.()) : null },
})

function loadUnsavedChanges(): Component {
  const file = resolve(uiApp, 'components/shared/form/UnsavedChanges.vue')
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const compiled = compileScript(descriptor, { id: 'escape-back-unsaved', inlineTemplate: true }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/import\.meta\.client/g, 'false')
    .replace('export default', 'return')
  const runnable = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const bindings: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(Vue).filter(([name]) => /^[a-zA-Z_$][\w$]*$/.test(name)).map(([name, value]) => [`_${name}`, value])),
    onBeforeRouteLeave: VueRouter.onBeforeRouteLeave, onBeforeRouteUpdate: VueRouter.onBeforeRouteUpdate,
    onMounted: () => undefined, onBeforeUnmount: () => undefined,
    ref: Vue.ref, watch: Vue.watch, computed: Vue.computed,
    navigateTo: (to: VueRouter.RouteLocationRaw) => router.push(to),
  }
  return new Function(...Object.keys(bindings), runnable)(...Object.values(bindings)) as Component
}

function mountRecord(record: Component) {
  const app = hostRenderer.createApp(defineComponent({ render: () => h(RouterView) }))
  app.component('UButton', passthroughButton)
  app.component('UModal', stubModal)
  app.config.globalProperties.$t = (key: string) => key
  app.use(router)
  const host = createHostNode()
  app.mount(host)
  mountedApps.push(app)
  return host
}

function escapeBackRoute(options: { backTo?: VueRouter.RouteLocationRaw; enabled?: () => boolean; dirty?: Vue.Ref<boolean> } = {}) {
  const UnsavedChanges = options.dirty ? loadUnsavedChanges() : null
  return defineComponent({
    setup() {
      useEscapeBack(() => options.backTo, () => options.enabled?.() ?? true)
      return () => h('div', [
        UnsavedChanges && options.dirty ? h(UnsavedChanges, { dirty: options.dirty.value }) : null,
        h('span', { 'data-testid': 'screen' }, 'record'),
      ])
    },
  })
}

// Escape hands the departure to the router, which settles over microtasks.
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  doc = createFakeDocument()
  globals.document = doc
  globals.useRouter = () => router
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  delete globals.document
  delete globals.useRouter
})

async function buildRouter(recordComponent: Component, start: string) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tasks', component: defineComponent({ setup: () => () => h('span', { 'data-testid': 'screen' }, 'list') }) },
      { path: '/tasks/:id', component: recordComponent },
    ],
  })
  await router.push(start)
  await router.isReady()
  const host = mountRecord(recordComponent)
  await nextTick()
  return host
}

describe('Escape returns a record to its own back target', () => {
  it('pushes the page back target that its visible back control uses', async () => {
    const record = escapeBackRoute({ backTo: { path: '/tasks', query: { view: 'board' } } })
    const host = await buildRouter(record, '/tasks/7?view=board')
    expect(doc.listenerCount(), 'the record must be listening for Escape').toBe(1)

    doc.press({ key: 'Escape', target: { tagName: 'BODY' } })
    await settle()

    expect(router.currentRoute.value.fullPath).toBe('/tasks?view=board')
    expect(findNode(host, node => node.props['data-testid'] === 'screen')?.text).toBe('list')
  })

  it('leaves Escape to an open reka-ui overlay instead of navigating too', async () => {
    const record = escapeBackRoute({ backTo: '/tasks' })
    await buildRouter(record, '/tasks/7')
    doc.overlayOpen = true

    doc.press({ key: 'Escape', target: { tagName: 'BODY' } })
    await settle()

    expect(router.currentRoute.value.path, 'a dropdown Escape must not also leave the record').toBe('/tasks/7')
  })

  it('leaves Escape alone while the caret is in a field, and ignores modified Escape', async () => {
    const record = escapeBackRoute({ backTo: '/tasks' })
    await buildRouter(record, '/tasks/7')

    doc.press({ key: 'Escape', target: { tagName: 'INPUT' } })
    doc.press({ key: 'Escape', target: { tagName: 'DIV', isContentEditable: true } })
    doc.press({ key: 'Escape', target: { tagName: 'DIV', closest: (selectors: string) => selectors.includes('textarea') ? { tagName: 'TEXTAREA' } : null } })
    doc.press({ key: 'Escape', target: { tagName: 'BODY' }, metaKey: true })
    doc.press({ key: 'Escape', target: { tagName: 'BODY' }, isComposing: true })
    doc.press({ key: 'Enter', target: { tagName: 'BODY' } })
    await settle()

    expect(router.currentRoute.value.path).toBe('/tasks/7')
  })

  it('stays silent on a page that shows no back control', async () => {
    const record = escapeBackRoute({ backTo: '/tasks', enabled: () => false })
    await buildRouter(record, '/tasks/7')

    doc.press({ key: 'Escape', target: { tagName: 'BODY' } })
    await settle()

    expect(router.currentRoute.value.path).toBe('/tasks/7')
  })

  it('stays silent when the page has no back target at all', async () => {
    const record = escapeBackRoute({})
    await buildRouter(record, '/tasks/7')

    doc.press({ key: 'Escape', target: { tagName: 'BODY' } })
    await settle()

    expect(router.currentRoute.value.path).toBe('/tasks/7')
  })

  it('lets the real unsaved-draft guard stop the Escape departure', async () => {
    // Escape navigates rather than emitting, so SharedUnsavedChanges answers it
    // through its own onBeforeRouteLeave — the draft is defended, not discarded.
    const dirty = ref(true)
    const record = escapeBackRoute({ backTo: { path: '/tasks', query: { view: 'board' } }, dirty })
    const host = await buildRouter(record, '/tasks/7?view=board')

    doc.press({ key: 'Escape', target: { tagName: 'BODY' } })
    await settle()

    expect(router.currentRoute.value.path, 'a dirty record must not be left by Escape').toBe('/tasks/7')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog'), 'the draft prompt must open').toBeTruthy()
    expect(findNode(host, node => node.props['data-testid'] === 'screen')?.text).toBe('record')
  })
})

describe('Escape handling on the server', () => {
  it('renders a header page on the server, where there is no document', async () => {
    // SharedPageHeader is on every page, so a bare `document` reference here
    // would take the whole app down during SSR.
    delete globals.document
    const page = defineComponent({ setup() { useEscapeBack(() => '/tasks'); return () => h('div', 'رأس الصفحة') } })
    await expect(renderToString(createSSRApp(page))).resolves.toContain('رأس الصفحة')
  })
})

describe('SharedPageHeader wires the one Escape implementation', () => {
  function headerState(path: string, props: Record<string, unknown>) {
    const file = resolve(uiApp, 'components/shared/layout/PageHeader.vue')
    const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
    const compiled = compileScript(descriptor, { id: 'page-header-escape', inlineTemplate: false }).content
      .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
      .replace('export default', 'return')
    const js = ts.transpileModule(compiled, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    }).outputText
    const calls: { backTo: () => unknown; enabled?: () => boolean }[] = []
    const localRouter = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:rest(.*)', component: { template: '<div/>' } }],
    })
    const bindings: Record<string, unknown> = {
      _defineComponent: Vue.defineComponent,
      computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
      useRoute: () => ({ path, query: {} }),
      useRouter: () => localRouter,
      useI18n: () => ({ t: (key: string) => key }),
      usePageHeader: () => undefined,
      useEscapeBack: (backTo: () => unknown, enabled?: () => boolean) => { calls.push({ backTo, enabled }) },
      useProjectFrameHeading: () => Vue.ref(false),
    }
    const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
    component.setup!(props, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} })
    return calls
  }

  it('hands the header its own back target and adds no second gate', () => {
    const backTo = { path: '/projects/7/tasks', query: { view: 'board' } }
    const record = headerState('/projects/7/tasks/99', { title: 'ملف', backTo })
    expect(record).toHaveLength(1)
    expect(record[0]!.backTo()).toBe(backTo)
    // The visible control and Escape must not be able to disagree: passing a
    // second condition here is exactly how they used to drift apart.
    expect(record[0]!.enabled, 'Escape is gated on the back target alone').toBeUndefined()
  })

  it('gives a page with no back target nothing for Escape to push', () => {
    // The record above is the only shape that gets Escape. A list or section
    // root supplies no target, and useEscapeBack returns early on undefined.
    const list = headerState('/tasks', { title: 'مهامي' })
    expect(list).toHaveLength(1)
    expect(list[0]!.backTo()).toBeUndefined()
  })
})
