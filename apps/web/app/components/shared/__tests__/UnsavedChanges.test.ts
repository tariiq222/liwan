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
import {
  isProjectOverlayRoute,
  PROJECT_OVERLAY_INJECTION_KEY,
  wantsProjectOverlayFullPage,
} from '../../../utils/projectOverlayRoute'

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
  const factory = new Function(
    '_defineComponent', '_unref', '_createVNode', '_createTextVNode', '_toDisplayString', '_withCtx', '_resolveComponent',
    '_createElementVNode', '_withModifiers', '_openBlock', '_createBlock', '_normalizeClass', 'onBeforeRouteLeave',
    'onBeforeRouteUpdate', 'AlertDialogRoot', 'AlertDialogPortal', 'AlertDialogOverlay', 'AlertDialogContent',
    'AlertDialogTitle', 'AlertDialogDescription', 'AlertDialogCancel', 'ref', 'watch', 'computed', 'inject', 'isProjectOverlayRoute', 'PROJECT_OVERLAY_INJECTION_KEY', 'wantsProjectOverlayFullPage', 'navigateTo', runnable,
  )
  return factory(
    Vue.defineComponent, Vue.unref, Vue.createVNode, Vue.createTextVNode, Vue.toDisplayString, Vue.withCtx, Vue.resolveComponent,
    Vue.createElementVNode, Vue.withModifiers, Vue.openBlock, Vue.createBlock, Vue.normalizeClass, VueRouter.onBeforeRouteLeave,
    VueRouter.onBeforeRouteUpdate, passthrough, passthrough, passthrough, passthrough, passthrough,
    passthrough, passthrough, Vue.ref, Vue.watch, Vue.computed, Vue.inject, isProjectOverlayRoute, PROJECT_OVERLAY_INJECTION_KEY, wantsProjectOverlayFullPage, (...args: Parameters<typeof router.push>) => router.push(...args),
  ) as Component
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
    app.component('Button', button)
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

  it('protects a dirty project workflow when switching standalone and modal presentation', async () => {
    const dirty = ref(true)
    const UnsavedChanges = loadUnsavedChanges()
    const WorkflowRoute = defineComponent({
      setup() {
        const route = useRoute()
        return () => h('div', [
          h(UnsavedChanges, { dirty: dirty.value }),
          h('span', { 'data-testid': 'presentation' }, route.query.fullPage ? 'full-page' : 'modal'),
        ])
      },
    })

    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/projects/:id/tasks/:taskId', component: WorkflowRoute }],
    })
    await router.push({ path: '/projects/3/tasks/7', query: { fullPage: '1' } })
    await router.isReady()

    const app = renderer.createApp(defineComponent({ render: () => h(RouterView) }))
    app.component('Button', button)
    app.config.globalProperties.$t = (key: string) => key
    app.use(router)
    const host = createHostNode()
    app.mount(host)
    mountedApps.push(app)

    const stayResult = await router.push({ path: '/projects/3/tasks/7', query: {} })
    expect(stayResult).toBeTruthy()
    expect(router.currentRoute.value.query.fullPage).toBe('1')
    expect(findNode(host, node => node.props['data-testid'] === 'unsaved-changes-dialog')).toBeTruthy()

    const buttons = findNodes(host, node => node.type === 'button')
    const discard = buttons.at(-1)?.props.onClick as (() => Promise<void>) | undefined
    expect(discard).toBeTypeOf('function')
    await discard?.()

    expect(router.currentRoute.value.query.fullPage).toBeUndefined()
    expect(findNode(host, node => node.props['data-testid'] === 'presentation')?.text).toBe('modal')
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
