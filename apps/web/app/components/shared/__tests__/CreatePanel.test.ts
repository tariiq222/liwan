import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, type App, type Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function loadCreatePanel(): Component {
  const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '../CreatePanel.vue')
  const descriptor = parse(readFileSync(sourcePath, 'utf8'), { filename: sourcePath }).descriptor
  const compiled = compileScript(descriptor, { id: 'create-panel-test', inlineTemplate: true }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const runnable = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const bindings: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(Vue).filter(([name]) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)).map(([name, value]) => [`_${name}`, value])),
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key, localeProperties: Vue.ref({ dir: 'rtl' }) }),
    usePageHeader: () => undefined,
    useRouter: () => router,
  }
  return new Function(...Object.keys(bindings), runnable)(...Object.values(bindings)) as Component
}

let router: ReturnType<typeof createRouter>

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
})

function findNode(node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode | undefined {
  if (predicate(node)) return node
  for (const child of node.children) {
    const match = findNode(child, predicate)
    if (match) return match
  }
  return undefined
}

function textOf(node: HostNode): string {
  return [node.text ?? '', ...node.children.map(textOf)].join('')
}

describe('SharedCreatePanel', () => {
  it('renders the title as h1', async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/tasks', component: { template: '<div/>' } },
        { path: '/tasks/new', component: { template: '<div/>' } },
      ],
    })
    await router.push('/tasks/new')
    await router.isReady()

    const CreatePanel = loadCreatePanel()
    const app = renderer.createApp(defineComponent({
      render: () => h(CreatePanel, { title: 'مهمة جديدة', backTo: '/tasks' }),
    }))
    app.component('UButton', defineComponent({
      inheritAttrs: false,
      setup(_, { attrs }) { return () => h('button', attrs) },
    }))
    app.component('USlideover', defineComponent({
      inheritAttrs: false,
      props: { open: Boolean, title: String, description: String, side: String, dismissible: Boolean, ui: Object },
      emits: ['update:open'],
      setup(_, { slots }) {
        return () => h('div', { role: 'dialog' }, [
          slots.header?.({ close: () => undefined }),
          slots.body?.(),
          slots.footer?.(),
        ])
      },
    }))
    const host = createHostNode()
    app.mount(host)
    mountedApps.push(app)

    const heading = findNode(host, node => node.type === 'h1')
    expect(heading).toBeTruthy()
    expect(textOf(heading!)).toContain('مهمة جديدة')
  })

  it('navigates to backTo when the slideover asks to close', async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/tasks', component: { template: '<div/>' } },
        { path: '/tasks/new', component: { template: '<div/>' } },
      ],
    })
    await router.push('/tasks/new')
    await router.isReady()

    const CreatePanel = loadCreatePanel()
    const app = renderer.createApp(defineComponent({
      render: () => h(CreatePanel, { title: 'مهمة جديدة', backTo: '/tasks' }),
    }))
    app.component('UButton', defineComponent({
      inheritAttrs: false,
      setup(_, { attrs }) { return () => h('button', attrs) },
    }))
    app.component('USlideover', defineComponent({
      inheritAttrs: false,
      props: { open: Boolean, title: String, description: String, side: String, dismissible: Boolean, ui: Object },
      emits: ['update:open'],
      setup(props, { emit }) {
        return () => h('div', {
          role: 'dialog',
          'data-open': props.open,
          onDismiss: () => emit('update:open', false),
        })
      },
    }))
    const host = createHostNode()
    app.mount(host)
    mountedApps.push(app)

    const dialog = findNode(host, node => node.props.role === 'dialog')
    expect(dialog).toBeTruthy()
    const dismiss = dialog!.props.onDismiss as (() => Promise<void> | void) | undefined
    expect(dismiss).toBeTypeOf('function')
    dismiss?.()
    // The stub's handler does not return the panel's async push; wait for the
    // router to settle on the destination instead of on the handler.
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/tasks'))
  })
})
