import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, ref, type App, type Component } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute } from 'vue-router'
import * as VueRouter from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

interface HostNode {
  children: HostNode[]
  parent: HostNode | null
  props: Record<string, unknown>
  text?: string
  type?: string
}

function createHostNode(type = 'root'): HostNode {
  return { type, children: [], parent: null, props: {} }
}

const renderer = createRenderer<HostNode, HostNode>({
  patchProp(node, key, _oldValue, value) {
    node.props[key] = value
  },
  insert(child, parent, anchor) {
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index === -1) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) {
    if (!child.parent) return
    const index = child.parent.children.indexOf(child)
    if (index !== -1) child.parent.children.splice(index, 1)
    child.parent = null
  },
  createElement: type => createHostNode(type),
  createText: text => ({ text, children: [], parent: null, props: {} }),
  createComment: text => ({ text, type: 'comment', children: [], parent: null, props: {} }),
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.text = text; node.children = [] },
  parentNode: node => node.parent,
  nextSibling(node) {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null
  },
  querySelector: () => null,
  setScopeId: () => {},
  cloneNode: node => ({ ...node, children: [...node.children], props: { ...node.props }, parent: null }),
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('static')
    node.text = content
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index === -1) parent.children.push(node)
    else parent.children.splice(index, 0, node)
    return [node, node]
  },
})

const mountedApps: App[] = []
const passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.())
  },
})
const button = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.())
  },
})

let router: ReturnType<typeof createRouter>

function loadUnsavedChanges(): Component {
  const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '../UnsavedChanges.vue')
  const descriptor = parse(readFileSync(sourcePath, 'utf8'), { filename: sourcePath }).descriptor
  const compiled = compileScript(descriptor, { id: 'unsaved-changes-test', inlineTemplate: true }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/import\.meta\.client/g, 'false')
    .replace('export default', 'return')
  const runnable = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const bindings: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(Vue).filter(([name]) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)).map(([name, value]) => [`_${name}`, value])),
    onBeforeRouteLeave: VueRouter.onBeforeRouteLeave, onBeforeRouteUpdate: VueRouter.onBeforeRouteUpdate,
    onMounted: () => undefined, onBeforeUnmount: () => undefined, ref: Vue.ref, watch: Vue.watch, computed: Vue.computed, inject: Vue.inject,
    navigateTo: (...args: Parameters<typeof router.push>) => router.push(...args),
  }
  return new Function(...Object.keys(bindings), runnable)(...Object.values(bindings)) as Component
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
})

describe('SharedUnsavedChanges route update guard', () => {
  it('keeps a dirty charter in edit mode on stay and reaches persisted mode on discard', async () => {
    const dirty = ref(true)
    const UnsavedChanges = loadUnsavedChanges()
    const CharterRoute = defineComponent({
      setup() {
        const route = useRoute()
        return () => h('div', [
          h(UnsavedChanges, { dirty: dirty.value, guardRouteUpdates: true }),
          h('span', { 'data-testid': 'mode' }, route.query.edit ? 'edit' : 'readonly'),
        ])
      },
    })

    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/projects/:id/charter', component: CharterRoute }],
    })
    await router.push({ path: '/projects/3/charter', query: { edit: '1' } })
    await router.isReady()

    const app = renderer.createApp(defineComponent({ render: () => h(RouterView) }))
    app.component('UButton', button)
    app.component('UModal', defineComponent({
      props: { open: Boolean, content: Object },
      setup(props, { slots }) { return () => props.open ? h('div', props.content, slots.footer?.()) : null },
    }))
    app.config.globalProperties.$t = (key: string) => key
    app.use(router)
    const host = createHostNode()
    app.mount(host)
    mountedApps.push(app)

    const stayResult = await router.push({ path: '/projects/3/charter', query: {} })
    expect(stayResult).toBeTruthy()
    expect(router.currentRoute.value.query.edit).toBe('1')
    expect(findNode(host, node => node.props['data-testid'] === 'mode')?.text).toBe('edit')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeTruthy()

    const buttons = findNodes(host, node => node.type === 'button')
    const discard = buttons.at(-1)?.props.onClick as (() => Promise<void>) | undefined
    expect(discard).toBeTypeOf('function')
    await discard?.()

    expect(router.currentRoute.value.query.edit).toBeUndefined()
    expect(findNode(host, node => node.props['data-testid'] === 'mode')?.text).toBe('readonly')
  })

  it('lets a guarded form rewrite its own ignored query keys while still guarding a real departure', async () => {
    const UnsavedChanges = loadUnsavedChanges()
    const WizardRoute = defineComponent({
      setup() {
        const route = useRoute()
        return () => h('div', [
          h(UnsavedChanges, { dirty: true, guardRouteUpdates: true, ignoreQueryKeys: ['step'] }),
          h('span', { 'data-testid': 'step' }, String(route.query.step ?? 'basics')),
          h('span', { 'data-testid': 'mode' }, route.query.edit ? 'edit' : 'readonly'),
        ])
      },
    })

    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/projects/:id/charter', component: WizardRoute }],
    })
    await router.push({ path: '/projects/3/charter', query: { edit: '1', step: 'basics' } })
    await router.isReady()

    const app = renderer.createApp(defineComponent({ render: () => h(RouterView) }))
    app.component('UButton', button)
    app.component('UModal', defineComponent({
      props: { open: Boolean, content: Object },
      setup(props, { slots }) { return () => props.open ? h('div', props.content, slots.footer?.()) : null },
    }))
    app.config.globalProperties.$t = (key: string) => key
    app.use(router)
    const host = createHostNode()
    app.mount(host)
    mountedApps.push(app)

    // The wizard moves to its next step: not a departure, no dialog.
    await router.replace({ path: '/projects/3/charter', query: { edit: '1', step: 'scope' } })
    expect(router.currentRoute.value.query.step).toBe('scope')
    expect(findNode(host, node => node.props['data-testid'] === 'step')?.text).toBe('scope')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeFalsy()

    // Dropping edit mode is a departure even though the path is unchanged.
    await router.push({ path: '/projects/3/charter', query: { step: 'scope' } })
    expect(router.currentRoute.value.query.edit).toBe('1')
    expect(findNode(host, node => node.props['data-testid'] === 'mode')?.text).toBe('edit')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeTruthy()
  })

  it('does not ask when only the hash changes, even on a form that guards its route updates', async () => {
    const UnsavedChanges = loadUnsavedChanges()
    const SettingsRoute = defineComponent({
      setup: () => () => h('div', [h(UnsavedChanges, { dirty: true, guardRouteUpdates: true })]),
    })
    router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/company', component: SettingsRoute }] })
    await router.push({ path: '/settings/company', query: { tab: 'a' }, hash: '#profile' })
    await router.isReady()
    const host = mountGuarded(router)

    await router.push({ path: '/settings/company', query: { tab: 'a' }, hash: '#contact' })
    expect(router.currentRoute.value.hash).toBe('#contact')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeFalsy()

    // A changed query on the same path is still a departure for a form that guards its route updates.
    await router.push({ path: '/settings/company', query: { tab: 'b' }, hash: '#contact' })
    expect(router.currentRoute.value.query.tab).toBe('a')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeTruthy()
  })

  it('asks once when several dirty forms are mounted and leaves after one confirmation', async () => {
    const UnsavedChanges = loadUnsavedChanges()
    const CardsRoute = defineComponent({
      setup: () => () => h('div', [h(UnsavedChanges, { dirty: true }), h(UnsavedChanges, { dirty: true }), h(UnsavedChanges, { dirty: true })]),
    })
    const OtherRoute = defineComponent({ setup: () => () => h('span', { 'data-testid': 'screen' }, 'other') })
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/settings/company', component: CardsRoute }, { path: '/settings/team', component: OtherRoute }],
    })
    await router.push('/settings/company')
    await router.isReady()
    const host = mountGuarded(router)

    await router.push('/settings/team')
    expect(router.currentRoute.value.path).toBe('/settings/company')
    expect(findNodes(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toHaveLength(1)

    const discard = findNodes(host, node => node.type === 'button').at(-1)?.props.onClick as (() => Promise<void>) | undefined
    await discard?.()
    expect(router.currentRoute.value.path).toBe('/settings/team')
    expect(findNode(host, node => node.props['data-testid'] === 'screen')?.text).toBe('other')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeFalsy()
  })

  it('protects a dirty project task page when its back link leaves for the task list', async () => {
    // The sheet's presentation toggle is gone: a project task is a page, so the
    // draft is defended on the ordinary departure its back link performs.
    const dirty = ref(true)
    const UnsavedChanges = loadUnsavedChanges()
    const TaskRoute = defineComponent({
      setup() {
        return () => h('div', [
          h(UnsavedChanges, { dirty: dirty.value }),
          h('span', { 'data-testid': 'screen' }, 'task'),
        ])
      },
    })
    const ListRoute = defineComponent({
      setup() {
        return () => h('span', { 'data-testid': 'screen' }, 'list')
      },
    })

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/projects/:id/tasks/:taskId', component: TaskRoute },
        { path: '/projects/:id/tasks', component: ListRoute },
      ],
    })
    await router.push({ path: '/projects/3/tasks/7', query: { q: 'عقد' } })
    await router.isReady()

    const app = renderer.createApp(defineComponent({ render: () => h(RouterView) }))
    app.component('UButton', button)
    app.component('UModal', defineComponent({
      props: { open: Boolean, content: Object },
      setup(props, { slots }) { return () => props.open ? h('div', props.content, slots.footer?.()) : null },
    }))
    app.config.globalProperties.$t = (key: string) => key
    app.use(router)
    const host = createHostNode()
    app.mount(host)
    mountedApps.push(app)

    const stayResult = await router.push({ path: '/projects/3/tasks', query: { q: 'عقد' } })
    expect(stayResult).toBeTruthy()
    expect(router.currentRoute.value.path).toBe('/projects/3/tasks/7')
    expect(findNode(host, node => node.props['data-testid'] === 'screen')?.text).toBe('task')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeTruthy()

    const buttons = findNodes(host, node => node.type === 'button')
    const discard = buttons.at(-1)?.props.onClick as (() => Promise<void>) | undefined
    expect(discard).toBeTypeOf('function')
    await discard?.()

    expect(router.currentRoute.value.fullPath).toBe('/projects/3/tasks?q=%D8%B9%D9%82%D8%AF')
    expect(findNode(host, node => node.props['data-testid'] === 'screen')?.text).toBe('list')
  })
})

function mountGuarded(guardedRouter: ReturnType<typeof createRouter>): HostNode {
  const app = renderer.createApp(defineComponent({ render: () => h(RouterView) }))
  app.component('UButton', button)
  app.component('UModal', defineComponent({
    props: { open: Boolean, content: Object },
    setup(props, { slots }) { return () => props.open ? h('div', props.content, slots.footer?.()) : null },
  }))
  app.config.globalProperties.$t = (key: string) => key
  app.use(guardedRouter)
  const host = createHostNode()
  app.mount(host)
  mountedApps.push(app)
  return host
}

function findNode(node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode | undefined {
  if (predicate(node)) return node
  for (const child of node.children) {
    const match = findNode(child, predicate)
    if (match) return match
  }
  return undefined
}

function findNodes(node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode[] {
  const matches = predicate(node) ? [node] : []
  return matches.concat(...node.children.map(child => findNodes(child, predicate)))
}
