import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, nextTick, onUnmounted, ref, type App, type Component, type Ref, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

interface HostNode {
  children: HostNode[]
  parent: HostNode | null
  text?: string
  type?: string
}

function createHostNode(type = 'root'): HostNode {
  return { type, children: [], parent: null }
}

const renderer = createRenderer<HostNode, HostNode>({
  patchProp: () => {},
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
  createText: text => ({ text, children: [], parent: null }),
  createComment: text => ({ text, type: 'comment', children: [], parent: null }),
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.text = text; node.children = [] },
  parentNode: node => node.parent,
  nextSibling(node) {
    if (!node.parent) return null
    const index = node.parent.children.indexOf(node)
    return node.parent.children[index + 1] ?? null
  },
  querySelector: () => null,
  setScopeId: () => {},
  cloneNode: node => ({ ...node, children: [...node.children], parent: null }),
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

function compileVueTemplate(path: string, id: string) {
  const source = readFileSync(path, 'utf8')
  const parsed = parse(source, { filename: path })
  if (!parsed.descriptor.template) throw new Error(`missing template: ${path}`)
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename: path,
    id,
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  return new Function('Vue', runnableCode)(Vue) as RenderFunction
}

const passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

const pageState = defineComponent({
  props: { error: { type: Object, default: undefined } },
  setup(props, { slots }) {
    return () => props.error ? h('div', { role: 'alert' }, 'retry') : h('div', slots.default?.())
  },
})

function mountWith(components: Record<string, Component>, component: Component) {
  const app = renderer.createApp(component)
  for (const [name, value] of Object.entries(components)) app.component(name, value)
  app.mount(createHostNode())
  mountedApps.push(app)
}

describe('task comment draft persistence', () => {
  it('keeps the mounted composer draft across timeline errors and task changes', async () => {
    const activityPath = resolve(dirname(fileURLToPath(import.meta.url)), '../TaskActivity.vue')
    const render = compileVueTemplate(activityPath, 'task-activity-draft')
    let draft: Ref<string> | undefined
    let mounts = 0
    let unmounts = 0
    const composer = defineComponent({
      props: { taskId: { type: Number, required: true } },
      setup() {
        mounts += 1
        draft = ref('')
        onUnmounted(() => { unmounts += 1 })
        return () => h('textarea', { value: draft?.value ?? '' })
      },
    })
    const state = {
      task: ref({ id: 1, can_write: true }),
      entries: ref([]),
      error: ref<unknown>(null),
      isLoading: ref(false),
      refetch: () => {},
    }
    const activity = defineComponent({
      setup() {
        return { ...state, t: (key: string) => key }
      },
      render,
    })
    mountWith({ SharedPageState: pageState, Timeline: passthrough, CommentComposer: composer }, activity)

    draft!.value = 'unsent comment'
    state.error.value = new Error('timeline unavailable')
    await nextTick()
    expect(draft!.value).toBe('unsent comment')
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)

    state.error.value = null
    await nextTick()
    expect(draft!.value).toBe('unsent comment')

    state.task.value = { id: 2, can_write: true }
    await nextTick()
    expect(mounts).toBe(2)
    expect(unmounts).toBe(1)
    expect(draft!.value).toBe('')
  })

  it('keeps task details mounted beside a cached task when the detail query errors', async () => {
    const detailPath = resolve(dirname(fileURLToPath(import.meta.url)), '../TaskDetailPanel.vue')
    const render = compileVueTemplate(detailPath, 'task-detail-draft')
    const error = ref<unknown>(null)
    const task = ref({
      id: 1,
      name: 'Cached task',
      project: { id: 2, name: 'Project' },
      allowed_actions: [],
      can_write: true,
    })
    let detailsMounts = 0
    let detailsUnmounts = 0
    const details = defineComponent({
      setup() {
        detailsMounts += 1
        onUnmounted(() => { detailsUnmounts += 1 })
        return () => h('div', 'details')
      },
    })
    const detail = defineComponent({
      setup() {
        const siblings = ref({ prevId: null, nextId: null })
        return {
          props: { taskId: 1, basePath: '/tasks', backTo: undefined, backLabel: undefined },
          route: { query: {} },
          task,
          error,
          siblings,
          hydrated: true,
          editingTitle: false,
          titleSaving: false,
          titleDraft: '',
          archiveConfirmOpen: false,
          archiving: false,
          isRtl: false,
          ArrowLeft: passthrough,
          ArrowRight: passthrough,
          ChevronLeft: passthrough,
          ChevronRight: passthrough,
          t: (key: string) => key,
          refetch: () => {},
          startTitleEdit: () => {},
          saveTitle: () => {},
          cancelTitleEdit: () => {},
          goTo: () => {},
          doArchive: () => {},
        }
      },
      render,
    })
    mountWith({
      SharedPageState: pageState,
      TaskDetails: details,
      TaskCompletionApproval: passthrough,
      StateMenu: passthrough,
      DeadlineBadge: passthrough,
      NuxtLink: passthrough,
      UButton: passthrough,
      UInput: passthrough,
      USkeleton: passthrough,
      Archive: passthrough,
      ArrowLeft: passthrough,
      ArrowRight: passthrough,
      ChevronLeft: passthrough,
      ChevronRight: passthrough,
      Check: passthrough,
      Pencil: passthrough,
      X: passthrough,
    }, detail)

    expect(detailsMounts).toBe(1)
    error.value = new Error('detail unavailable')
    await nextTick()
    expect(detailsMounts).toBe(1)
    expect(detailsUnmounts).toBe(0)
    expect(task.value.name).toBe('Cached task')
  })
})
