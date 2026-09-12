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
