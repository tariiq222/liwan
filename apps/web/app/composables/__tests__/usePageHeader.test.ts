import { createRenderer, defineComponent, h, nextTick, reactive, ref, type App, type Component } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePageHeader, useShellPageHeader } from '../usePageHeader'

interface HostNode {
  children: HostNode[]
  parent: HostNode | null
  text?: string
  type?: string
}

function createHostNode(type = 'root'): HostNode {
  return { type, children: [], parent: null }
}

function insertHostNode(child: HostNode, parent: HostNode, anchor?: HostNode | null) {
  child.parent = parent
  const index = anchor ? parent.children.indexOf(anchor) : -1
  if (index === -1) parent.children.push(child)
  else parent.children.splice(index, 0, child)
}

const renderer = createRenderer<HostNode, HostNode>({
  patchProp: () => {},
  insert(child, parent, anchor) {
    insertHostNode(child, parent, anchor)
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
  setElementText(node, text) {
    node.text = text
    node.children = []
  },
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
    insertHostNode(node, parent, anchor)
    return [node, node]
  },
})

const mountedApps: App[] = []

function mount(component: Component) {
  const app = renderer.createApp(component)
  app.mount(createHostNode())
  mountedApps.push(app)
  return app
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  vi.unstubAllGlobals()
})

describe('usePageHeader', () => {
  it('does not let an outgoing page claim the next route during an overlap', async () => {
    const route = reactive({ path: '/projects/1/tasks/10' })
    const pageState = ref(null)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useState', () => pageState)

    let shell: ReturnType<typeof useShellPageHeader> | undefined
    const Shell = defineComponent({
      setup() {
        shell = useShellPageHeader()
        return () => h('div')
      },
    })

    const outgoingTitle = ref('Outgoing task')
    const OutgoingPage = defineComponent({
      setup() {
        usePageHeader(outgoingTitle)
        return () => h('div')
      },
    })

    const incomingTitle = ref('Task details')
    const IncomingPage = defineComponent({
      setup() {
        usePageHeader(incomingTitle)
        return () => h('div')
      },
    })

    const showOutgoing = ref(true)
    const showIncoming = ref(false)
    mount(defineComponent({
      setup() {
        return () => h('div', [
          h(Shell),
          showOutgoing.value ? h(OutgoingPage) : null,
          showIncoming.value ? h(IncomingPage) : null,
        ])
      },
    }))

    expect(shell?.title.value).toBe('Outgoing task')

    route.path = '/projects/1/tasks/11'
    await nextTick()
    expect(shell?.title.value).toBeUndefined()

    showIncoming.value = true
    await nextTick()
    expect(shell?.title.value).toBe('Task details')

    incomingTitle.value = 'Incoming task'
    await nextTick()
    expect(shell?.title.value).toBe('Incoming task')

    showOutgoing.value = false
    await nextTick()
    expect(shell?.title.value).toBe('Incoming task')

    showIncoming.value = false
    await nextTick()
    expect(shell?.title.value).toBeUndefined()
  })
})
